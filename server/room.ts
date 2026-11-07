import { DEFAULT_CONFIG, DIFFICULTIES, LEARNING_RATE, STUDENT_IDS, STUDENTS, type StudentPersona } from "../src/lib/meeting/students";
import type {
  ChatMessage,
  ClassConfig,
  ClassPhase,
  ClientCommand,
  CoachTip,
  Debrief,
  DebriefStudent,
  LocalPatch,
  LocalUser,
  Participant,
  ScorePoint,
  ServerEvent,
  TranscriptLine,
} from "../src/lib/meeting/types";
import { BrainError, type AgentBrain, type Assessment, type Moment, type StudentState } from "./brain";
import { coachTipFor, extractQuestions, rulesNarrative, wordCount } from "./classStats";
import type { SpeechService } from "./voices";

export interface RoomTiming {
  firstStudentMs: number;
  studentGapMs: number;
  /** Pace of captions, set to roughly match natural speech. */
  wordMs: number;
  /** How long an empty room waits for someone to come back. */
  emptyGraceMs: number;
}

export interface RoomLimits {
  /** Model calls allowed in one class. Each thing the lecturer says uses up to two. */
  maxTurns: number;
  /** Messages one person may send per minute. */
  messagesPerMinute: number;
}

export const DEFAULT_TIMING: RoomTiming = {
  firstStudentMs: 1000,
  studentGapMs: 800,
  wordMs: 320,
  emptyGraceMs: 10 * 60_000,
};

export const DEFAULT_LIMITS: RoomLimits = { maxTurns: 200, messagesPerMinute: 30 };

const MAX_INPUT_LENGTH = 2000;
const MAX_DELTA = 15;
const LOST_BELOW = 30;
const GOT_IT_ABOVE = 70;
const COACH_GAP_TURNS = 3;
/** Lecturer turns a hand stays up before the student gives up and lowers it. */
const HAND_PATIENCE_TURNS = 4;
/** A drop this big in one turn makes a student put their hand up to ask. */
const CONFUSED_DROP = 5;
/** Quiet students hold back unless the drop is bigger than this, or they're lost. */
const QUIET_CONFUSED_DROP = 8;
/** In a chaotic class: the chance a second student talks over the first... */
const CHAOS_CHIME_IN = 0.35;
/** ...and the chance someone blurts something out when nobody was going to speak. */
const CHAOS_BLURT = 0.3;
const GREETING = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|welcome)\b/i;
/** Replies that show a student has dropped the role are thrown away. */
const OUT_OF_CHARACTER = /\b(as an ai|language model|my (system )?(prompt|instructions))\b/i;

const MAX_TOKENS_PER_MINUTE = 10;

const MAX_SPOKEN_WORDS = 35;

/**
 * Removes stage directions such as "(pause)", which a voice would read aloud, and keeps a
 * reply to a length people would actually say in class, ending on a whole sentence if possible.
 */
export function speakable(text: string) {
  const cleaned = text
    // Only when standing alone, so code and maths such as O(n), arr[i] and 2*n*3 survive.
    .replace(/(^|\s)(\([^)]*\)|\[[^\]]*\]|\*[^*]*\*)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,?!])/g, "$1")
    .trim();
  const words = cleaned.split(" ");
  if (words.length <= MAX_SPOKEN_WORDS) return cleaned;
  const start = words.slice(0, MAX_SPOKEN_WORDS).join(" ");
  const sentenceEnd = Math.max(start.lastIndexOf(". "), start.lastIndexOf("? "), start.lastIndexOf("! "));
  return sentenceEnd > 0 ? start.slice(0, sentenceEnd + 1) : start;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Human {
  send: (event: ServerEvent) => void;
  participant: Participant;
  sendTimes: number[];
}

interface RoomOptions {
  brain: AgentBrain;
  timing?: RoomTiming;
  limits?: RoomLimits;
  autoJoinIds?: string[];
  /** Hosted student voices. Without one, browsers use their built-in voices. */
  speech?: SpeechService;
  /** Called once the room has stayed empty for the grace period. */
  onEmpty: () => void;
  /** Source of chance for a chaotic class, replaceable in tests. */
  random?: () => number;
}

/** A student waiting to be called on, and what they want to say. */
interface Hand {
  intent: string;
  confused: boolean;
  raisedTurn: number;
  lineId: string;
}

/** One class: who's in it, what's been said, and how well each student is following. */
export class Room {
  private humans = new Map<string, Human>();
  private students = new Map<string, Participant>();
  private hostId: string | null = null;
  private config: ClassConfig | null = null;
  private phase: ClassPhase = "live";
  private startedAt = 0;

  private messages: ChatMessage[] = [];
  private transcript: TranscriptLine[] = [];
  private nextLineId = 1;
  private nextMessageId = 1;
  private moments: Moment[] = [];
  private tips: CoachTip[] = [];
  private debrief: Debrief | null = null;

  private scores = new Map<string, number>();
  private history = new Map<string, ScorePoint[]>();
  private quietTurns = new Map<string, number>();
  private spokenTurns = new Map<string, number>();
  private spokenWords = new Map<string, number>();
  private lecturerTurns = 0;
  private turnsWithoutQuestion = 0;
  private lastTipTurn = -COACH_GAP_TURNS;

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private studentsScheduled = false;
  private destroyed = false;

  /** Lecturer input is handled strictly in order. */
  private queue: Promise<void> = Promise.resolve();
  private pendingInputs = 0;
  /** Only one student speaks at a time. */
  private hands = new Map<string, Hand>();
  private floorId: string | null = null;
  private floorController: AbortController | null = null;
  private inFlight = new Set<AbortController>();

  private totalTurns = 0;
  private limitAnnounced = false;
  private brainDown = false;
  private lastTransientNotice = 0;

  private readonly brain: AgentBrain;
  private readonly timing: RoomTiming;
  private readonly limits: RoomLimits;
  private readonly autoJoinIds: string[];
  private readonly speech?: SpeechService;
  private readonly onEmpty: () => void;
  private readonly random: () => number;
  /** The latest shared screen. Kept only in memory, and replaced or cleared, never logged. */
  private screen: string | null = null;
  private screenWasShared = false;
  private nextCueId = 1;
  private tokenTimes: number[] = [];

  constructor(options: RoomOptions) {
    this.brain = options.brain;
    this.timing = options.timing ?? DEFAULT_TIMING;
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.autoJoinIds = options.autoJoinIds ?? STUDENT_IDS;
    this.speech = options.speech;
    this.random = options.random ?? Math.random;
    this.onEmpty = options.onEmpty;
  }

  get humanCount() {
    return this.humans.size;
  }

  private get classConfig() {
    return this.config ?? DEFAULT_CONFIG;
  }

  private now() {
    return Date.now() - this.startedAt;
  }

  join(user: LocalUser, send: Human["send"], config?: ClassConfig) {
    this.clearEmptyTimer();
    if (!this.config) {
      this.config = config ?? DEFAULT_CONFIG;
      this.startedAt = Date.now();
    }
    const existing = this.humans.get(user.id);
    const participant: Participant = existing?.participant ?? {
      ...user,
      kind: "human",
      muted: true,
      cameraOn: false,
      handRaisedAt: null,
      status: "idle",
    };
    this.humans.set(user.id, { send, participant, sendTimes: existing?.sendTimes ?? [] });
    this.hostId ??= user.id;
    const isLecturer = user.id === this.hostId;

    send({
      type: "snapshot",
      participants: this.everyone().filter((p) => p.id !== user.id),
      messages: this.messages,
      catalog: STUDENTS.map(({ id, name, role, description, color }) => ({ id, name, role, description, color })),
      hostId: this.hostId,
      engine: this.brain.engine,
      liveTranscription: this.speech !== undefined,
      config: this.classConfig,
      phase: this.phase,
      scores: isLecturer ? this.scoresObject() : {},
      tips: isLecturer ? this.tips : [],
      debrief: isLecturer ? this.debrief : null,
    });
    if (!existing) this.broadcast({ type: "participant.joined", participant }, user.id);
    this.scheduleStudents();
  }

  /** `send` identifies the socket, so a stale one closing can't remove a reconnected user. */
  leave(id: string, send: Human["send"]) {
    if (this.humans.get(id)?.send !== send) return;
    this.humans.delete(id);
    this.broadcast({ type: "participant.left", id });
    if (id === this.hostId) this.screen = null;

    if (this.hostId === id && this.humans.size > 0) {
      this.hostId = this.humans.keys().next().value ?? null;
      if (this.hostId) {
        this.broadcast({ type: "host", id: this.hostId });
        this.toLecturer({ type: "class.scores", scores: this.scoresObject() });
      }
    }

    if (this.humans.size === 0) {
      // Nobody is listening, so stop spending on replies.
      this.abortAll();
      this.emptyTimer = setTimeout(() => this.onEmpty(), this.timing.emptyGraceMs);
    }
  }

  destroy() {
    this.destroyed = true;
    this.clearEmptyTimer();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.abortAll();
  }

  handle(senderId: string, command: ClientCommand) {
    const sender = this.humans.get(senderId);
    if (!sender) return;

    switch (command.type) {
      case "chat.send":
        this.handleInput(sender, command.text, "chat");
        return;
      case "reaction.send":
        this.broadcast({ type: "reaction", senderId, emoji: command.emoji });
        return;
      case "local.update":
        this.handleLocalUpdate(sender, command.patch);
        return;
    }

    if (senderId !== this.hostId) {
      sender.send({ type: "notice", message: "Only the lecturer can do that." });
      return;
    }

    switch (command.type) {
      case "class.say":
        this.handleInput(sender, command.text, "spoken");
        break;
      case "class.end":
        void this.endClass(sender.participant.name);
        break;
      case "stt.token":
        void this.issueTranscriptionToken(sender);
        break;
      case "screen.frame":
        if (this.phase === "live") {
          this.screen = command.data;
          this.screenWasShared = true;
        }
        break;
      case "screen.stop":
        this.screen = null;
        break;
      case "agent.invite":
        this.addStudent(command.agentId);
        break;
      case "agent.remove":
        this.removeStudent(command.id);
        break;
      case "agent.setMuted":
        this.setStudentMuted(command.id, command.muted);
        break;
      case "agent.callOn":
        this.callOn(sender, command.id);
        break;
      case "agents.muteAll":
        [...this.students.keys()].forEach((id) => this.setStudentMuted(id, true));
        break;
    }
  }

  /** Only the lecturer gets one, because transcription is billed to the server's key. */
  private async issueTranscriptionToken(sender: Human) {
    const now = Date.now();
    this.tokenTimes = this.tokenTimes.filter((time) => now - time < 60_000);
    if (!this.speech || this.tokenTimes.length >= MAX_TOKENS_PER_MINUTE) {
      sender.send({ type: "stt.token", token: null });
      return;
    }
    this.tokenTimes.push(now);
    try {
      sender.send({ type: "stt.token", token: await this.speech.transcriptionToken() });
    } catch (error) {
      console.error("[voices]", error instanceof Error ? error.message : error);
      sender.send({ type: "stt.token", token: null });
    }
  }

  private everyone(): Participant[] {
    return [...[...this.humans.values()].map((h) => h.participant), ...this.students.values()];
  }

  private broadcast(event: ServerEvent, exceptId?: string) {
    this.humans.forEach((human, id) => {
      if (id !== exceptId) human.send(event);
    });
  }

  /** Scores and coaching are private to the lecturer. */
  private toLecturer(event: ServerEvent) {
    if (this.hostId) this.humans.get(this.hostId)?.send(event);
  }

  private clearEmptyTimer() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  private scoresObject() {
    return Object.fromEntries(this.scores);
  }

  private persona(id: string): StudentPersona | undefined {
    return STUDENTS.find((student) => student.id === id);
  }

  private scheduleStudents() {
    if (this.studentsScheduled) return;
    this.studentsScheduled = true;
    this.autoJoinIds.forEach((id, index) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.destroyed) this.addStudent(id);
      }, this.timing.firstStudentMs + index * this.timing.studentGapMs);
      this.timers.add(timer);
    });
  }

  private addStudent(id: string) {
    const persona = this.persona(id);
    if (!persona || this.students.has(id) || this.phase !== "live") return;
    const participant: Participant = {
      id,
      name: persona.name,
      kind: "agent",
      color: persona.color,
      role: persona.role,
      muted: false,
      cameraOn: false,
      handRaisedAt: null,
      status: "listening",
    };
    this.students.set(id, participant);

    if (!this.scores.has(id)) {
      const offset = DIFFICULTIES.find((d) => d.id === this.classConfig.difficulty)?.offset ?? 0;
      const start = clamp(persona.baseScore + offset, 5, 95);
      this.scores.set(id, start);
      this.history.set(id, [{ at: this.now(), score: start }]);
    }
    this.quietTurns.set(id, 0);
    this.broadcast({ type: "participant.joined", participant });
    this.toLecturer({ type: "class.scores", scores: this.scoresObject() });
  }

  private removeStudent(id: string) {
    if (!this.students.has(id)) return;
    this.lowerHand(id);
    this.releaseFloor(id);
    this.students.delete(id);
    this.broadcast({ type: "participant.left", id });
  }

  private setStudentMuted(id: string, muted: boolean) {
    if (muted) {
      this.lowerHand(id);
      this.releaseFloor(id);
    }
    this.updateStudent(id, { muted });
  }

  private updateStudent(id: string, patch: Partial<Participant>) {
    const student = this.students.get(id);
    if (!student) return;
    this.students.set(id, { ...student, ...patch });
    this.broadcast({ type: "participant.updated", id, patch });
  }

  private handleLocalUpdate(sender: Human, patch: LocalPatch) {
    sender.participant = { ...sender.participant, ...patch };
    this.broadcast({ type: "participant.updated", id: sender.participant.id, patch }, sender.participant.id);
  }

  private abortAll() {
    this.inFlight.forEach((controller) => controller.abort());
    if (this.floorId) this.releaseFloor(this.floorId);
  }

  private releaseFloor(id: string) {
    if (this.floorId !== id) return;
    this.floorId = null;
    this.floorController?.abort();
    this.floorController = null;
    this.broadcast({ type: "speech.stop" });
    this.broadcast({ type: "caption", speakerId: id, text: "", final: true });
    this.updateStudent(id, { status: "listening" });
  }

  /** Spends one model call if this class's limit allows it. */
  private spendTurn() {
    if (this.brainDown) return false;
    if (!this.brain.metered) return true;
    if (this.totalTurns >= this.limits.maxTurns) {
      if (!this.limitAnnounced) {
        this.limitAnnounced = true;
        this.broadcast({ type: "notice", message: "This class reached its turn limit, so students have gone quiet." });
      }
      return false;
    }
    this.totalTurns++;
    return true;
  }

  private abortable() {
    const controller = new AbortController();
    this.inFlight.add(controller);
    return { controller, done: () => this.inFlight.delete(controller) };
  }

  private addLine(line: Omit<TranscriptLine, "id" | "at">) {
    const full: TranscriptLine = { ...line, id: `t${this.nextLineId++}`, at: this.now() };
    this.transcript = [...this.transcript, full];
    return full;
  }

  private handleInput(sender: Human, rawText: string, channel: "spoken" | "chat") {
    const text = rawText.trim();
    if (!text) return;
    if (this.phase !== "live") return;
    if (text.length > MAX_INPUT_LENGTH) {
      sender.send({ type: "notice", message: `Messages can be up to ${MAX_INPUT_LENGTH} characters.` });
      return;
    }
    const now = Date.now();
    sender.sendTimes = sender.sendTimes.filter((time) => now - time < 60_000);
    if (sender.sendTimes.length >= this.limits.messagesPerMinute) {
      sender.send({ type: "notice", message: "You're going too quickly. Try again in a moment." });
      return;
    }
    sender.sendTimes.push(now);

    const { participant } = sender;
    if (channel === "chat") {
      this.postChat(participant, text);
    } else {
      this.broadcast({ type: "caption", speakerId: participant.id, text, final: true });
    }

    // Anyone else in the room is observing. Only the lecturer's words shape the class.
    if (participant.id !== this.hostId) return;

    // Talking over a student cuts them off, as it would in a room.
    if (this.floorId) this.releaseFloor(this.floorId);

    const line = this.addLine({
      speakerId: participant.id,
      speakerName: participant.name,
      role: "lecturer",
      channel,
      text,
    });
    this.pendingInputs++;
    this.queue = this.queue.then(() => this.processInput(line)).catch((error) => this.onBrainError(error));
  }

  private studentStates(): StudentState[] {
    return [...this.students.keys()].flatMap((id) => {
      const persona = this.persona(id);
      return persona
        ? [{ persona, score: this.scores.get(id) ?? 0, quietTurns: this.quietTurns.get(id) ?? 0 }]
        : [];
    });
  }

  private async processInput(line: TranscriptLine) {
    this.pendingInputs--;
    this.lecturerTurns++;
    this.students.forEach((_, id) => this.quietTurns.set(id, (this.quietTurns.get(id) ?? 0) + 1));
    this.turnsWithoutQuestion = extractQuestions(line).length > 0 ? 0 : this.turnsWithoutQuestion + 1;

    if (this.phase !== "live" || this.destroyed || this.humans.size === 0) return;
    this.expireHands();
    if (this.students.size === 0 || !this.spendTurn()) {
      this.coach(line);
      return;
    }

    // Being addressed by name always wins. It also means the student is already known, so
    // they can start answering while scoring runs alongside, which cuts the wait noticeably.
    const named = this.namedStudent(line);
    const namedReply =
      named && this.pendingInputs === 0
        ? this.studentTurn(named, this.calledOnIntent(named, "The lecturer just spoke to you by name."), line.channel)
        : null;

    const { controller, done } = this.abortable();
    let assessment: Assessment | null = null;
    try {
      assessment = await this.brain.assess({
        config: this.classConfig,
        students: this.studentStates(),
        transcript: this.transcript,
        latest: line,
        screen: this.screen,
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted) this.onBrainError(error);
    } finally {
      done();
    }

    if (assessment && !controller.signal.aborted) {
      const confused = this.applyAssessment(assessment, line);
      this.coach(line, assessment.abusive);
      const chosen = assessment.nextSpeakerId ? this.students.get(assessment.nextSpeakerId) : undefined;
      const speaker = chosen && !chosen.muted && chosen.id !== named ? chosen.id : null;

      if (this.handsUp(line)) {
        // An orderly class: nobody talks until called on, so wanting to speak means a hand goes up.
        if (speaker) this.raiseHand(speaker, assessment.intent, false, line);
        if (extractQuestions(line).length > 0) this.raiseEagerHands(line, [named ?? null, speaker]);
        for (const { id, reason } of confused) {
          if (id === named) continue;
          const why = reason ? ` (${reason})` : "";
          this.raiseHand(id, `You've just got confused${why}. Ask the lecturer about the part you didn't follow.`, true, line);
        }
      } else if (!named && this.pendingInputs === 0 && this.phase === "live") {
        // If the lecturer has already moved on, a reply to this line would be out of date.
        if (speaker) await this.studentTurn(speaker, assessment.intent, line.channel);
        if (this.classConfig.difficulty === "chaotic" && line.channel === "spoken") await this.chaos(speaker);
      }
    }
    await namedReply;
  }

  /**
   * Students raise hands, except in a chaotic class, in chat (where people just type),
   * and in reply to a simple greeting, which someone just answers.
   */
  private handsUp(line: TranscriptLine) {
    if (this.classConfig.difficulty === "chaotic" || line.channel === "chat") return false;
    return !(GREETING.test(line.text) && wordCount(line.text) <= 12 && extractQuestions(line).length === 0);
  }

  private raiseHand(id: string, intent: string, confused: boolean, line: TranscriptLine) {
    const student = this.students.get(id);
    if (!student || student.muted || this.floorId === id) return;
    const existing = this.hands.get(id);
    if (existing) {
      // Already waiting: being confused now is the more pressing reason to be called on.
      if (confused && !existing.confused) this.hands.set(id, { ...existing, intent, confused, lineId: line.id });
      return;
    }
    this.hands.set(id, { intent, confused, raisedTurn: this.lecturerTurns, lineId: line.id });
    this.updateStudent(id, { handRaisedAt: Date.now() });
  }

  private lowerHand(id: string) {
    if (!this.hands.delete(id)) return;
    this.updateStudent(id, { handRaisedAt: null });
  }

  /** After a question to the class, keen students who think they know put a hand up too. */
  private raiseEagerHands(line: TranscriptLine, skip: (string | null)[]) {
    for (const { persona, score } of this.studentStates()) {
      if (skip.includes(persona.id) || score < 40) continue;
      if (this.random() < persona.eagerness * 0.6) {
        this.raiseHand(persona.id, `Answer the lecturer's question: "${line.text}"`, false, line);
      }
    }
  }

  /** Nobody waits forever. A confused student whose hand went unanswered is a missed signal. */
  private expireHands() {
    this.hands.forEach((hand, id) => {
      if (this.lecturerTurns - hand.raisedTurn < HAND_PATIENCE_TURNS) return;
      if (hand.confused) {
        this.moments.push({
          lineId: hand.lineId,
          studentId: id,
          kind: "missed_signal",
          note: "put a hand up because they were confused, and wasn't called on.",
        });
      }
      this.lowerHand(id);
    });
  }

  /** What a student says when called on: what they raised their hand for, if it's up. */
  private calledOnIntent(id: string, fallback: string) {
    const hand = this.hands.get(id);
    if (!hand) return fallback;
    return `You had your hand up. ${hand.intent} The lecturer has now called on you, so say it, taking into account anything they've said since.`;
  }

  /** The lecturer picks a student with their hand up. */
  private callOn(sender: Human, id: string) {
    const student = this.students.get(id);
    if (!student || student.muted || this.phase !== "live") return;
    const text = `Go ahead, ${student.name}.`;
    if (this.floorId) this.releaseFloor(this.floorId);
    this.broadcast({ type: "caption", speakerId: sender.participant.id, text, final: true });
    this.addLine({ speakerId: sender.participant.id, speakerName: sender.participant.name, role: "lecturer", channel: "spoken", text });
    const intent = this.calledOnIntent(id, "The lecturer has called on you. Say what's on your mind about the lesson.");
    this.pendingInputs++;
    this.queue = this.queue
      .then(async () => {
        this.pendingInputs--;
        if (this.phase === "live" && !this.destroyed) await this.studentTurn(id, intent, "spoken");
      })
      .catch((error) => this.onBrainError(error));
  }

  /** A chaotic class: people talk over each other and call out without being asked. */
  private async chaos(speaker: string | null) {
    const others = this.studentStates().filter(({ persona }) => persona.id !== speaker && !this.students.get(persona.id)?.muted);
    if (others.length === 0) return;
    const pick = () => {
      // Talkative students are the likeliest to call out.
      const total = others.reduce((sum, { persona }) => sum + persona.eagerness, 0);
      let roll = this.random() * total;
      for (const state of others) {
        roll -= state.persona.eagerness;
        if (roll <= 0) return state.persona.id;
      }
      return others[others.length - 1].persona.id;
    };
    const stillCurrent = () => this.pendingInputs === 0 && this.phase === "live" && !this.destroyed;
    if (speaker && this.random() < CHAOS_CHIME_IN && stillCurrent()) {
      await this.studentTurn(
        pick(),
        "Jump in without being asked, talking over the class: react to what was just said, crack a joke, disagree, or drift off-topic, as a distracted student on a Friday afternoon would.",
        "spoken",
      );
    } else if (!speaker && this.random() < CHAOS_BLURT && stillCurrent()) {
      await this.studentTurn(
        pick(),
        "Call out without being asked: a side comment, a complaint, something off-topic, or a remark to a classmate.",
        "spoken",
      );
    }
  }

  private namedStudent(line: TranscriptLine) {
    const lowered = line.text.toLowerCase();
    return [...this.students.values()].find(
      (student) => !student.muted && new RegExp(`(^|\\W)@?${student.name.toLowerCase()}\\b`).test(lowered),
    )?.id;
  }

  /** Applies score changes. Returns the students who just got confused enough to want to ask. */
  private applyAssessment(assessment: Assessment, line: TranscriptLine) {
    const at = line.at;
    const confused: { id: string; reason: string }[] = [];
    this.students.forEach((student, id) => {
      const previous = this.scores.get(id) ?? 0;
      const raw = assessment.deltas[id] ?? 0;
      const persona = STUDENTS.find((s) => s.id === id);
      const rate = persona ? LEARNING_RATE[persona.aptitude] : { gain: 1, loss: 1 };
      // Able students learn faster and are knocked back less by unclear teaching.
      const delta = clamp(Math.round(raw * (raw >= 0 ? rate.gain : rate.loss)), -MAX_DELTA, MAX_DELTA);
      const next = clamp(previous + delta, 0, 100);
      this.scores.set(id, next);
      this.history.get(id)?.push({ at, score: next });

      const reason = assessment.reasons[id] ?? "";
      const becameLost = previous >= LOST_BELOW && next < LOST_BELOW;
      const quiet = (persona?.eagerness ?? 0.5) < 0.3;
      if (becameLost || delta <= -(quiet ? QUIET_CONFUSED_DROP : CONFUSED_DROP)) confused.push({ id, reason });
      if (becameLost) {
        this.moments.push({
          lineId: line.id,
          studentId: id,
          kind: "lost",
          note: reason ? `started to get lost here (${reason}).` : "started to get lost here.",
        });
      } else if (previous < GOT_IT_ABOVE && next >= GOT_IT_ABOVE) {
        this.moments.push({ lineId: line.id, studentId: id, kind: "breakthrough", note: reason });
        this.broadcast({ type: "reaction", senderId: student.id, emoji: "💡" });
      }
    });

    for (const moment of assessment.moments) {
      if (this.students.has(moment.studentId)) this.moments.push({ ...moment, lineId: line.id });
    }
    this.toLecturer({ type: "class.scores", scores: this.scoresObject() });
    return confused;
  }

  private coach(line: TranscriptLine, abusive = false) {
    const message = abusive
      ? "Keep it respectful. In a real class, that would cost you the students' trust."
      : this.lecturerTurns - this.lastTipTurn >= COACH_GAP_TURNS
        ? coachTipFor({
            latestWords: wordCount(line.text),
            turnsWithoutQuestion: this.turnsWithoutQuestion,
            quietStudents: this.studentStates().map(({ persona, quietTurns, score }) => ({
              name: persona.name,
              quietTurns,
              score,
            })),
          })
        : null;
    if (!message) return;
    this.lastTipTurn = this.lecturerTurns;
    const tip: CoachTip = { id: `c${this.tips.length + 1}`, message, at: this.now() };
    this.tips = [...this.tips, tip];
    this.toLecturer({ type: "class.coach", tip });
  }

  private async studentTurn(id: string, intent: string, channel: "spoken" | "chat") {
    const student = this.studentStates().find((state) => state.persona.id === id);
    if (!student || !this.spendTurn()) return;
    this.lowerHand(id);

    const { controller, done } = this.abortable();
    this.floorId = id;
    this.floorController = controller;
    this.updateStudent(id, { status: "thinking" });

    const holdsFloor = () => this.floorController === controller && !controller.signal.aborted;
    let text = "";
    let generating = true;

    const pump = async () => {
      try {
        for await (const delta of this.brain.generate({
          student,
          config: this.classConfig,
          transcript: this.transcript,
          roster: this.everyone().map((p) => p.name),
          channel,
          intent,
          screen: this.screen,
          signal: controller.signal,
        })) {
          if (!holdsFloor()) return;
          text += delta;
        }
      } catch (error) {
        this.onBrainError(error);
      } finally {
        generating = false;
        done();
      }
    };

    // The student stays "thinking" until the whole reply exists, so a line that drops the
    // role is caught before anyone hears it. Replies are short, so the wait is brief.
    const reveal = async () => {
      if (channel === "chat") return "";
      while (generating && holdsFloor()) await sleep(30);
      if (!holdsFloor() || OUT_OF_CHARACTER.test(text)) return "";
      const reply = speakable(text);
      const words = reply.split(/\s+/).filter(Boolean);
      if (words.length === 0) return "";

      this.updateStudent(id, { status: "speaking" });
      this.broadcast({
        type: "speech",
        cue: {
          id: `s${this.nextCueId++}`,
          speakerId: id,
          text: reply,
          audioPath: this.speech?.prepare(id, reply) ?? null,
        },
      });

      // The line is recorded when the student starts talking, so an interruption lands after
      // it, and it only ever holds the words they got out before being cut off.
      const line = this.addLine({
        speakerId: id,
        speakerName: student.persona.name,
        role: "student",
        channel,
        text: words[0],
      });

      // Captions follow at speaking pace, however fast the model produced the words.
      let last = "";
      for (let shown = 1; shown <= words.length && holdsFloor(); shown++) {
        last = words.slice(0, shown).join(" ");
        line.text = last;
        this.broadcast({ type: "caption", speakerId: id, text: last, final: false });
        await sleep(this.timing.wordMs);
      }
      return last;
    };

    const [, spoken] = await Promise.all([pump(), reveal()]);
    const held = holdsFloor();
    const reply = channel === "chat" ? (held ? text.trim() : "") : spoken;

    if (reply && !OUT_OF_CHARACTER.test(reply)) {
      if (channel === "chat") {
        this.addLine({ speakerId: id, speakerName: student.persona.name, role: "student", channel, text: reply });
      }
      this.spokenTurns.set(id, (this.spokenTurns.get(id) ?? 0) + 1);
      this.spokenWords.set(id, (this.spokenWords.get(id) ?? 0) + wordCount(reply));
      this.quietTurns.set(id, 0);
      const participant = this.students.get(id);
      if (channel === "chat" && participant) this.postChat(participant, reply);
    }

    if (held) {
      this.floorId = null;
      this.floorController = null;
      if (channel === "spoken") {
        this.broadcast({ type: "caption", speakerId: id, text: spoken, final: true });
      }
      this.updateStudent(id, { status: "listening" });
    }
  }

  private postChat(sender: Pick<Participant, "id" | "name">, text: string) {
    const message: ChatMessage = {
      id: `m${this.nextMessageId++}`,
      senderId: sender.id,
      senderName: sender.name,
      text,
      sentAt: Date.now(),
    };
    this.messages = [...this.messages, message];
    this.broadcast({ type: "chat.message", message });
  }

  private async endClass(lecturerName: string) {
    if (this.phase !== "live") return;
    this.phase = "ended";
    this.screen = null;
    this.abortAll();
    this.broadcast({ type: "class.phase", phase: "ended" });

    const durationMs = this.now();
    const lecturerLines = this.transcript.filter((line) => line.role === "lecturer");
    const lecturerWords = lecturerLines.reduce((sum, line) => sum + wordCount(line.text), 0);
    const questions = lecturerLines.flatMap(extractQuestions);
    const students: DebriefStudent[] = [...this.history.entries()].flatMap(([id, history]) => {
      const persona = this.persona(id);
      if (!persona) return [];
      return [
        {
          id,
          name: persona.name,
          role: persona.role,
          history,
          turns: this.spokenTurns.get(id) ?? 0,
          words: this.spokenWords.get(id) ?? 0,
        },
      ];
    });

    const request = {
      config: this.classConfig,
      lecturerName,
      transcript: this.transcript,
      students,
      questions,
      moments: this.moments,
      lecturerWords,
      sharedScreen: this.screenWasShared,
    };

    let narrative = rulesNarrative(request);
    let feedbackSource: Debrief["feedbackSource"] = "rules";
    if (this.transcript.length > 0 && this.brain.metered && !this.brainDown) {
      const { controller, done } = this.abortable();
      try {
        const written = await this.brain.debrief({ ...request, signal: controller.signal });
        // Feedback may only point at things that were really said.
        const ids = new Set(this.transcript.map((line) => line.id));
        const real = (list: typeof written.strengths) => list.filter((p) => p.lineId && ids.has(p.lineId));
        narrative = {
          summary: written.summary,
          strengths: real(written.strengths),
          missedSignals: real(written.missedSignals),
          improvements: real(written.improvements),
        };
        feedbackSource = "claude";
      } catch (error) {
        if (!controller.signal.aborted) console.error("[room] debrief fell back to rules:", error);
      } finally {
        done();
      }
    }
    if (this.destroyed) return;

    this.debrief = {
      ...narrative,
      config: this.classConfig,
      durationMs,
      lecturerName,
      lecturerWords,
      students,
      questions,
      transcript: this.transcript,
      feedbackSource,
    };
    this.toLecturer({ type: "class.debrief", debrief: this.debrief });
  }

  private onBrainError(error: unknown) {
    const kind = error instanceof BrainError ? error.kind : "transient";
    const reason = error instanceof BrainError ? error.message : "Something went wrong.";
    if (!(error instanceof BrainError)) console.error("[room] turn failed:", error);

    if (kind === "fatal") {
      if (this.brainDown) return;
      this.brainDown = true;
      this.broadcast({ type: "notice", message: `Students are paused. ${reason}` });
    } else if (Date.now() - this.lastTransientNotice > 30_000) {
      this.lastTransientNotice = Date.now();
      this.broadcast({ type: "notice", message: `A student couldn't respond. ${reason}` });
    }
  }
}
