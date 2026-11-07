import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { WebSocket } from "ws";
import { DEFAULT_CONFIG, STUDENTS } from "../src/lib/meeting/students";
import type { ServerEvent, TranscriptLine } from "../src/lib/meeting/types";
import { createMeetingServer } from "./app";
import {
  BrainError,
  type AgentBrain,
  type AssessRequest,
  type Assessment,
  type GenerateRequest,
} from "./brain";
import { ClaudeBrain } from "./claudeBrain";
import { coachTipFor, extractQuestions } from "./classStats";
import { buildStudentTurn } from "./prompt";
import { speakable, type RoomLimits, type RoomTiming } from "./room";
import { ScriptedBrain } from "./scriptedBrain";

const ORIGIN = "http://localhost:3000";
const FAST: RoomTiming = { firstStudentMs: 5, studentGapMs: 1, wordMs: 1, emptyGraceMs: 50 };
const LIMITS: RoomLimits = { maxTurns: 100, messagesPerMinute: 100 };

/** A brain that records each request and answers instantly, for free. */
class FakeBrain implements AgentBrain {
  readonly engine = "live";
  readonly metered = true;
  assessments: AssessRequest[] = [];
  replies: GenerateRequest[] = [];
  debriefs = 0;
  error: Error | null = null;
  verdict: Partial<Assessment> = {};
  reply = "Hello there from class";

  async assess(request: AssessRequest): Promise<Assessment> {
    this.assessments.push(request);
    if (this.error) throw this.error;
    return {
      deltas: {},
      reasons: {},
      nextSpeakerId: null,
      intent: "reacting",
      moments: [],
      abusive: false,
      ...this.verdict,
    };
  }

  async *generate(request: GenerateRequest) {
    this.replies.push(request);
    yield this.reply;
  }

  async debrief() {
    this.debriefs++;
    return {
      summary: "A short class.",
      strengths: [{ text: "Real point", lineId: "t1" }],
      missedSignals: [{ text: "Invented point", lineId: "t999" }],
      improvements: [],
    };
  }
}

const servers: { close(): Promise<void> }[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.terminate());
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** Chance never fires unless a test says so, which keeps chaotic classes predictable. */
async function startServer(brain: AgentBrain, limits = LIMITS, autoJoinIds = ["marcus", "priya"], random = () => 1) {
  const server = createMeetingServer({ brain, allowedOrigins: [ORIGIN], timing: FAST, limits, autoJoinIds, random });
  servers.push(server);
  return server.listen(0, "127.0.0.1");
}

interface Client {
  socket: WebSocket;
  events: ServerEvent[];
  send(message: unknown): void;
  waitFor(match: (event: ServerEvent) => boolean, ms?: number): Promise<ServerEvent>;
}

async function connect(port: number, id: string, config: unknown = DEFAULT_CONFIG): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  sockets.push(socket);
  const events: ServerEvent[] = [];
  socket.on("message", (data) => events.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client: Client = {
    socket,
    events,
    send: (message) => socket.send(JSON.stringify(message)),
    async waitFor(match, ms = 2000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const found = events.find(match);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(`timed out; saw: ${events.map((event) => event.type).join(", ")}`);
    },
  };
  client.send({
    type: "hello",
    meetingCode: "abc-defg-hij",
    user: { id, name: id, color: "#ec407a" },
    config,
  });
  await client.waitFor((event) => event.type === "snapshot");
  return client;
}

const joined = (id: string) => (event: ServerEvent) =>
  event.type === "participant.joined" && event.participant.id === id;
const lastScores = (client: Client) =>
  client.events.filter((event) => event.type === "class.scores").at(-1) as
    | { scores: Record<string, number> }
    | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Students in a chaotic class speak straight away, so most tests use one. */
const CHAOTIC = { topic: "Recursion", difficulty: "chaotic" };
const TYPICAL = { topic: "Recursion", difficulty: "typical" };

async function classWithStudents(brain: AgentBrain, limits = LIMITS, config: unknown = CHAOTIC) {
  const port = await startServer(brain, limits);
  const lecturer = await connect(port, "lecturer", config);
  await lecturer.waitFor(joined("priya"));
  return { port, lecturer };
}

test("the first person is the lecturer, and the chosen topic and students arrive", async () => {
  const port = await startServer(new FakeBrain());
  const lecturer = await connect(port, "lecturer", { topic: "Big-O notation", difficulty: "chaotic" });
  const snapshot = lecturer.events[0];
  assert.ok(snapshot.type === "snapshot");
  assert.equal(snapshot.hostId, "lecturer");
  assert.deepEqual(snapshot.config, { topic: "Big-O notation", difficulty: "chaotic" });
  await lecturer.waitFor(joined("marcus"));
  await lecturer.waitFor(joined("priya"));
});

test("class mood shifts starting understanding", async () => {
  const port = await startServer(new FakeBrain());
  const lecturer = await connect(port, "lecturer", { topic: "Recursion", difficulty: "chaotic" });
  await lecturer.waitFor(joined("priya"));
  await pause(20);
  assert.equal(lastScores(lecturer)?.scores.priya, 20);
});

test("scores change only with the assessment, and stay private to the lecturer", async () => {
  const brain = new FakeBrain();
  const { port, lecturer } = await classWithStudents(brain);
  const observer = await connect(port, "observer");
  const start = lastScores(lecturer)?.scores.priya ?? 0;

  brain.verdict = { deltas: { priya: 10, marcus: -99 } };
  lecturer.send({ type: "class.say", text: "Think of it as a set of nested boxes." });
  await pause(50);

  const scores = lastScores(lecturer)?.scores;
  assert.equal(scores?.priya, start + 10);
  assert.equal(scores?.marcus, 45 - 15, "a change is capped at 15");

  const snapshot = observer.events[0];
  assert.ok(snapshot.type === "snapshot");
  assert.deepEqual(snapshot.scores, {});
  assert.ok(!observer.events.some((event) => event.type === "class.scores"));
});

test("able students learn faster and are knocked back less", async () => {
  const brain = new FakeBrain();
  const port = await startServer(brain, LIMITS, ["leo", "samira"]);
  const lecturer = await connect(port, "lecturer");
  await lecturer.waitFor(joined("samira"));
  await pause(20);
  const start = lastScores(lecturer)?.scores ?? {};

  brain.verdict = { deltas: { leo: 8, samira: 8 } };
  lecturer.send({ type: "class.say", text: "For example, picture a stack of plates." });
  await pause(50);
  const gained = lastScores(lecturer)?.scores ?? {};
  assert.equal(gained.leo - start.leo, 4, "aptitude 1 gains half");
  assert.equal(gained.samira - start.samira, 12, "aptitude 5 gains half again");

  brain.verdict = { deltas: { leo: -10, samira: -10 } };
  lecturer.send({ type: "class.say", text: "The amortized invariant follows trivially." });
  await pause(50);
  const lost = lastScores(lecturer)?.scores ?? {};
  assert.equal(lost.leo - gained.leo, -14);
  assert.equal(lost.samira - gained.samira, -7);
});

const handOf = (client: Client, id: string) =>
  client.events
    .filter((e) => e.type === "participant.updated" && e.id === id && "handRaisedAt" in e.patch)
    .map((e) => (e.type === "participant.updated" ? e.patch.handRaisedAt : undefined))
    .at(-1);

test("in an orderly class, a student who wants to speak raises a hand and waits", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, LIMITS, TYPICAL);
  brain.verdict = { nextSpeakerId: "marcus", intent: "say it's just a loop" };
  lecturer.send({ type: "class.say", text: "Recursion is when a function calls itself." });
  await lecturer.waitFor((e) => e.type === "participant.updated" && e.id === "marcus" && typeof e.patch.handRaisedAt === "number");
  await pause(40);
  assert.equal(brain.replies.length, 0, "nobody speaks until called on");

  brain.verdict = {};
  lecturer.send({ type: "class.say", text: "Yes, Marcus?" });
  await lecturer.waitFor((e) => e.type === "caption" && e.speakerId === "marcus" && e.final);
  assert.match(brain.replies[0].intent, /hand up[\s\S]*say it's just a loop/);
  assert.equal(handOf(lecturer, "marcus"), null, "speaking lowers the hand");
});

test("a greeting is answered without a hand going up", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, LIMITS, TYPICAL);
  brain.verdict = { nextSpeakerId: "marcus", intent: "say hi" };
  lecturer.send({ type: "class.say", text: "Hi everyone, welcome." });
  await lecturer.waitFor((e) => e.type === "caption" && e.speakerId === "marcus" && e.final);
});

test("a confused student puts a hand up, and calling on them lets them ask", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, LIMITS, TYPICAL);
  brain.verdict = { deltas: { marcus: -8 }, reasons: { marcus: "unexplained jargon" } };
  lecturer.send({ type: "class.say", text: "The stack frame unwinds after the base case." });
  await lecturer.waitFor((e) => e.type === "participant.updated" && e.id === "marcus" && typeof e.patch.handRaisedAt === "number");
  assert.equal(brain.replies.length, 0);

  lecturer.send({ type: "agent.callOn", id: "marcus" });
  await lecturer.waitFor((e) => e.type === "caption" && e.speakerId === "lecturer" && e.text === "Go ahead, Marcus.");
  await lecturer.waitFor((e) => e.type === "caption" && e.speakerId === "marcus" && e.final);
  assert.match(brain.replies[0].intent, /confused \(unexplained jargon\)/);
});

test("quiet students only put a hand up when they're really lost", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, LIMITS, TYPICAL);
  brain.verdict = { deltas: { priya: 20 } };
  lecturer.send({ type: "class.say", text: "Think of nested boxes." });
  await pause(30);
  brain.verdict = { deltas: { priya: -5 } };
  lecturer.send({ type: "class.say", text: "Moving on quickly." });
  await pause(50);
  assert.equal(handOf(lecturer, "priya"), undefined, "a small drop isn't enough for her");

  brain.verdict = { deltas: { priya: -9 } };
  lecturer.send({ type: "class.say", text: "And the stack frame unwinds." });
  await lecturer.waitFor((e) => e.type === "participant.updated" && e.id === "priya" && typeof e.patch.handRaisedAt === "number");
});

test("an ignored confused hand goes down after a while and counts as a missed signal", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, LIMITS, TYPICAL);
  brain.verdict = { deltas: { marcus: -8 } };
  lecturer.send({ type: "class.say", text: "The stack frame unwinds." });
  await lecturer.waitFor((e) => e.type === "participant.updated" && e.id === "marcus" && typeof e.patch.handRaisedAt === "number");
  brain.verdict = {};
  for (const text of ["One.", "Two.", "Three.", "Four."]) lecturer.send({ type: "class.say", text });
  await lecturer.waitFor((e) => e.type === "participant.updated" && e.id === "marcus" && e.patch.handRaisedAt === null);
  assert.equal(brain.replies.length, 0);
});

test("in a chaotic class nobody raises a hand, and someone may talk over the speaker", async () => {
  const brain = new FakeBrain();
  const port = await startServer(brain, LIMITS, ["marcus", "priya"], () => 0);
  const lecturer = await connect(port, "lecturer", CHAOTIC);
  await lecturer.waitFor(joined("priya"));
  brain.verdict = { nextSpeakerId: "marcus", deltas: { marcus: -10 } };
  lecturer.send({ type: "class.say", text: "Recursion is when a function calls itself." });
  await lecturer.waitFor((e) => e.type === "caption" && e.speakerId === "priya" && e.final);
  assert.deepEqual(brain.replies.map((r) => r.student.persona.id), ["marcus", "priya"]);
  assert.match(brain.replies[1].intent, /without being asked/);
  assert.equal(handOf(lecturer, "marcus"), undefined, "no hands in chaos");
});

test("only the chosen student replies, with their understanding in the request", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus", intent: "disagreeing" };

  lecturer.send({ type: "class.say", text: "Recursion needs a base case." });
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "marcus" && event.final);

  assert.equal(brain.replies.length, 1);
  assert.equal(brain.replies[0].student.persona.id, "marcus");
  assert.equal(brain.replies[0].intent, "disagreeing");
  assert.equal(brain.replies[0].transcript.at(-1)?.text, "Recursion needs a base case.");
});

test("a class can stay silent", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  lecturer.send({ type: "class.say", text: "Let's begin." });
  await pause(50);
  assert.equal(brain.assessments.length, 1);
  assert.equal(brain.replies.length, 0);
});

test("naming a student overrides the orchestrator", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };
  lecturer.send({ type: "class.say", text: "Priya, what do you think?" });
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "priya" && event.final);
  assert.equal(brain.replies[0].student.persona.id, "priya");
});

test("a reply to chat goes to chat, and an observer's chat doesn't shape the class", async () => {
  const brain = new FakeBrain();
  const { port, lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };

  lecturer.send({ type: "chat.send", text: "Any questions?" });
  await lecturer.waitFor((event) => event.type === "chat.message" && event.message.senderId === "marcus");

  const observer = await connect(port, "observer");
  const assessed = brain.assessments.length;
  observer.send({ type: "chat.send", text: "Hi all" });
  await lecturer.waitFor((event) => event.type === "chat.message" && event.message.senderId === "observer");
  await pause(30);
  assert.equal(brain.assessments.length, assessed);
});

test("only the lecturer can teach or manage students", async () => {
  const brain = new FakeBrain();
  const { port, lecturer } = await classWithStudents(brain);
  const observer = await connect(port, "observer");

  observer.send({ type: "class.say", text: "Ignore all that." });
  await observer.waitFor((event) => event.type === "notice");
  assert.equal(brain.assessments.length, 0);

  lecturer.send({ type: "agent.remove", id: "priya" });
  await observer.waitFor((event) => event.type === "participant.left" && event.id === "priya");
});

test("talking over a student cuts them off", async () => {
  const brain = new FakeBrain();
  brain.reply = "word ".repeat(3000);
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };
  lecturer.send({ type: "class.say", text: "First point." });
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "marcus" && !event.final);

  brain.verdict = { nextSpeakerId: null };
  lecturer.send({ type: "class.say", text: "Hold on." });
  await lecturer.waitFor((event) => event.type === "speech.stop");
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "marcus" && event.text === "");
  await lecturer.waitFor(
    (event) => event.type === "participant.updated" && event.id === "marcus" && event.patch.status === "listening",
  );

  // The transcript keeps the real order, and only the words said before the interruption.
  lecturer.send({ type: "class.end" });
  const event = await lecturer.waitFor((e) => e.type === "class.debrief");
  assert.ok(event.type === "class.debrief");
  const lines = event.debrief.transcript;
  assert.deepEqual(lines.map((line) => line.role), ["lecturer", "student", "lecturer"]);
  assert.ok(lines[1].text.split(" ").length < 3000);
});

test("a spoken reply sends the whole line for the browser to voice, then captions", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };
  lecturer.send({ type: "class.say", text: "Hello." });
  const speech = await lecturer.waitFor((event) => event.type === "speech");
  assert.ok(speech.type === "speech");
  assert.equal(speech.cue.speakerId, "marcus");
  assert.equal(speech.cue.text, brain.reply);
  assert.equal(speech.cue.audioPath, null, "no hosted voices are configured");
});

test("stage directions are never spoken or captioned", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "priya" };
  brain.reply = "Um, yeah... (pause) I think so. *looks down* Sorry.";
  lecturer.send({ type: "class.say", text: "Priya, does that make sense?" });
  const speech = await lecturer.waitFor((event) => event.type === "speech");
  assert.ok(speech.type === "speech");
  assert.equal(speech.cue.text, "Um, yeah... I think so. Sorry.");
});

const FRAME = `/9j/${"A".repeat(100)}`;

test("students and the orchestrator get the current screen, until sharing stops", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };

  lecturer.send({ type: "screen.frame", data: FRAME });
  lecturer.send({ type: "class.say", text: "What's on this slide?" });
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "marcus" && event.final);
  assert.equal(brain.assessments[0].screen, FRAME);
  assert.equal(brain.replies[0].screen, FRAME);

  const newer = `/9j/${"B".repeat(100)}`;
  lecturer.send({ type: "screen.frame", data: newer });
  lecturer.send({ type: "class.say", text: "And now?" });
  await pause(60);
  assert.equal(brain.assessments[1].screen, newer, "the slide they just moved to, not the old one");

  lecturer.send({ type: "screen.stop" });
  lecturer.send({ type: "class.say", text: "What about now?" });
  await pause(60);
  assert.equal(brain.assessments[2].screen, null);
});

test("only the lecturer can share, and only real JPEG frames are accepted", async () => {
  const brain = new FakeBrain();
  const { port, lecturer } = await classWithStudents(brain);
  const observer = await connect(port, "observer");

  observer.send({ type: "screen.frame", data: FRAME });
  await observer.waitFor((event) => event.type === "notice");
  lecturer.send({ type: "screen.frame", data: "not-an-image" });
  lecturer.send({ type: "screen.frame", data: `/9j/${"A".repeat(1_000_001)}` });
  lecturer.send({ type: "class.say", text: "Hello?" });
  await pause(60);
  assert.equal(brain.assessments[0].screen, null);
  assert.equal(lecturer.socket.readyState, WebSocket.OPEN, "a bad frame is ignored, not fatal");
});

test("the screen is gone once the class ends, and the debrief knows one was shared", async () => {
  const brain = new FakeBrain();
  let sharedScreen: boolean | undefined;
  const original = brain.debrief.bind(brain);
  brain.debrief = async (request?: unknown) => {
    sharedScreen = (request as { sharedScreen: boolean }).sharedScreen;
    return original();
  };
  const { lecturer } = await classWithStudents(brain);
  lecturer.send({ type: "screen.frame", data: FRAME });
  lecturer.send({ type: "class.say", text: "Here's my slide." });
  await pause(40);
  lecturer.send({ type: "class.end" });
  const event = await lecturer.waitFor((e) => e.type === "class.debrief");
  assert.equal(sharedScreen, true);
  assert.ok(!JSON.stringify(event).includes(FRAME), "the debrief must not carry the image");
});

test("cleaning up speech keeps code and maths intact", () => {
  assert.equal(speakable("The worst case is O(n), right?"), "The worst case is O(n), right?");
  assert.equal(speakable("So arr[i] holds 2*n*3 items."), "So arr[i] holds 2*n*3 items.");
  assert.equal(speakable("(pause) I think so (sighs) yeah."), "I think so yeah.");
  assert.equal(speakable("Right *nods*, okay."), "Right, okay.");
});

test("long replies are cut to a natural length, at a sentence end", () => {
  const long = `${"word ".repeat(20).trim()}. Second sentence here. ${"more ".repeat(40).trim()}.`;
  assert.equal(speakable(long), `${"word ".repeat(20).trim()}. Second sentence here.`);
  assert.equal(speakable("Short and fine."), "Short and fine.");
  assert.equal(speakable("word ".repeat(50)).split(" ").length, 35);
});

test("a student who drops the role is not heard", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { nextSpeakerId: "marcus" };
  brain.reply = "As an AI language model, I can explain recursion perfectly.";
  lecturer.send({ type: "class.say", text: "Please explain recursion." });
  await pause(100);
  assert.ok(!lecturer.events.some((event) => event.type === "speech"));
  assert.ok(!lecturer.events.some((event) => event.type === "caption" && event.text.includes("language")));

  lecturer.send({ type: "class.end" });
  const debrief = await lecturer.waitFor((event) => event.type === "class.debrief");
  assert.ok(debrief.type === "class.debrief");
  assert.ok(!debrief.debrief.transcript.some((line) => line.text.includes("language model")));
});

test("the turn limit stops model calls and says so once", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain, { ...LIMITS, maxTurns: 1 });
  lecturer.send({ type: "class.say", text: "one" });
  lecturer.send({ type: "class.say", text: "two" });
  lecturer.send({ type: "class.say", text: "three" });
  await lecturer.waitFor((event) => event.type === "notice");
  await pause(30);
  assert.equal(brain.assessments.length, 1);
  assert.equal(lecturer.events.filter((event) => event.type === "notice").length, 1);
});

test("a rejected API key pauses students and tells people once", async () => {
  const brain = new FakeBrain();
  brain.error = new BrainError("fatal", "The server's Claude API key was rejected.");
  const { lecturer } = await classWithStudents(brain);
  lecturer.send({ type: "class.say", text: "first" });
  await lecturer.waitFor((event) => event.type === "notice");
  lecturer.send({ type: "class.say", text: "second" });
  await pause(50);
  assert.equal(brain.assessments.length, 1);
  assert.equal(lecturer.events.filter((event) => event.type === "notice").length, 1);
});

test("the debrief has the history and stats, and drops feedback citing lines that don't exist", async () => {
  const brain = new FakeBrain();
  const { lecturer } = await classWithStudents(brain);
  brain.verdict = { deltas: { priya: 5 }, nextSpeakerId: "marcus" };
  lecturer.send({ type: "class.say", text: "How would you define it? Is that clear?" });
  await lecturer.waitFor((event) => event.type === "caption" && event.speakerId === "marcus" && event.final);

  lecturer.send({ type: "class.end" });
  await lecturer.waitFor((event) => event.type === "class.phase" && event.phase === "ended");
  const event = await lecturer.waitFor((e) => e.type === "class.debrief");
  assert.ok(event.type === "class.debrief");
  const { debrief } = event;

  assert.equal(debrief.feedbackSource, "claude");
  assert.deepEqual(debrief.strengths, [{ text: "Real point", lineId: "t1" }]);
  assert.deepEqual(debrief.missedSignals, []);
  assert.deepEqual(debrief.questions.map((q) => q.kind), ["open", "closed"]);
  assert.equal(debrief.lecturerWords, 8);

  const priya = debrief.students.find((student) => student.id === "priya");
  assert.deepEqual(priya?.history.map((point) => point.score), [20, 25]);
  const marcus = debrief.students.find((student) => student.id === "marcus");
  assert.equal(marcus?.turns, 1);

  lecturer.send({ type: "class.say", text: "One more thing" });
  await pause(30);
  assert.equal(brain.assessments.length, 1, "teaching stops once the class has ended");
});

test("if the coach fails, the debrief falls back to rules", async () => {
  const brain = new FakeBrain();
  brain.debrief = async () => {
    throw new BrainError("transient", "down");
  };
  const { lecturer } = await classWithStudents(brain);
  lecturer.send({ type: "class.say", text: "Hello everyone." });
  await pause(30);
  lecturer.send({ type: "class.end" });
  const event = await lecturer.waitFor((e) => e.type === "class.debrief");
  assert.ok(event.type === "class.debrief");
  assert.equal(event.debrief.feedbackSource, "rules");
});

test("scripted students react to good and bad teaching differently", async () => {
  const brain = new ScriptedBrain();
  const { lecturer } = await classWithStudents(brain);
  const start = lastScores(lecturer)?.scores.priya ?? 0;

  lecturer.send({ type: "class.say", text: "First, imagine a stack of boxes. Then open each one. Does that make sense?" });
  await lecturer.waitFor((e) => e.type === "class.scores" && e.scores.priya > start);

  const up = lastScores(lecturer)?.scores.priya ?? 0;
  lecturer.send({ type: "class.say", text: "Tail-call amortized asymptotic memoization of the call stack." });
  await lecturer.waitFor((e) => e.type === "class.scores" && e.scores.priya < up);
});

test("questions are classified as open or closed", () => {
  const line: TranscriptLine = {
    id: "t1",
    at: 0,
    speakerId: "x",
    speakerName: "x",
    role: "lecturer",
    channel: "spoken",
    text: "Here's one. Why does this stop? Is that clear? Can you explain it back to me? Priya, what do you think?",
  };
  assert.deepEqual(extractQuestions(line).map((q) => q.kind), ["open", "closed", "open", "open"]);
});

test("coaching notices a quiet, confused student before anything else", () => {
  const tip = coachTipFor({
    latestWords: 200,
    turnsWithoutQuestion: 9,
    quietStudents: [{ name: "Priya", quietTurns: 5, score: 20 }],
  });
  assert.match(String(tip), /Priya/);
  assert.equal(coachTipFor({ latestWords: 20, turnsWithoutQuestion: 1, quietStudents: [] }), null);
});

test("connections from other origins and malformed hellos are refused", async () => {
  const port = await startServer(new FakeBrain());

  const foreign = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "https://evil.example" });
  sockets.push(foreign);
  const status = await new Promise((resolve) => {
    foreign.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    foreign.once("error", () => resolve("error"));
  });
  assert.ok(status === 401 || status === "error");

  const bad = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  sockets.push(bad);
  await new Promise((resolve) => bad.once("open", resolve));
  bad.send(JSON.stringify({ type: "hello", meetingCode: "../etc", user: {} }));
  const code = await new Promise((resolve) => bad.once("close", resolve));
  assert.equal(code, 4001);
});

/* ClaudeBrain against a local stand-in for the API. This checks our requests and our
   handling of responses, not how the real model behaves. */

let apiMode: "stream" | "json" | "deny" = "stream";
let apiJson: unknown = {};
const captured: { headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];

function sse(events: { type: string }[]) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

const baseMessage = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

const fakeApi = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    captured.push({ headers: request.headers, body: JSON.parse(body) });
    if (apiMode === "deny") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "no" } }));
    } else if (apiMode === "json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ...baseMessage,
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(apiJson) }],
        }),
      );
    } else {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        sse([
          { type: "message_start", message: { ...baseMessage, content: [], stop_reason: null } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Um... " } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I think so." } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
          { type: "message_stop" },
        ] as { type: string }[]),
      );
    }
  });
});

after(() => {
  fakeApi.close();
});

async function claudeBrain() {
  if (!fakeApi.listening) await new Promise<void>((resolve) => fakeApi.listen(0, "127.0.0.1", resolve));
  const { port } = fakeApi.address() as AddressInfo;
  captured.length = 0;
  return new ClaudeBrain({
    client: new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 }),
  });
}

const priya = STUDENTS.find((student) => student.id === "priya")!;
const transcript: TranscriptLine[] = [
  { id: "t1", at: 0, speakerId: "l", speakerName: "Alex", role: "lecturer", channel: "spoken", text: "Hello" },
];

const studentRequest = (): GenerateRequest => ({
  student: { persona: priya, score: 20, quietTurns: 3 },
  config: DEFAULT_CONFIG,
  transcript,
  roster: ["Alex", "Priya"],
  channel: "spoken",
  intent: "asked directly",
  screen: null,
  signal: new AbortController().signal,
});

test("ClaudeBrain sends the shared screen as an image, ahead of the text", async () => {
  const brain = await claudeBrain();
  apiMode = "stream";
  for await (const delta of brain.generate({ ...studentRequest(), screen: "/9j/abc" })) void delta;

  const [message] = captured[0].body.messages as { content: { type: string; source?: unknown; text?: string }[] }[];
  assert.equal(message.content[0].type, "image");
  assert.deepEqual(message.content[0].source, { type: "base64", media_type: "image/jpeg", data: "/9j/abc" });
  assert.match(String(message.content[1].text), /shared screen right now/);

  captured.length = 0;
  for await (const delta of brain.generate(studentRequest())) void delta;
  assert.match(JSON.stringify(captured[0].body.messages), /isn't sharing their screen/);
  assert.ok(!JSON.stringify(captured[0].body.messages).includes('"image"'));
});

test("ClaudeBrain streams a student's reply and sends the expected request", async () => {
  const brain = await claudeBrain();
  apiMode = "stream";
  let text = "";
  for await (const delta of brain.generate(studentRequest())) text += delta;

  assert.equal(text, "Um... I think so.");
  const { body, headers } = captured[0];
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.stream, true);
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.match(String(headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.match(String(body.system), /You play Priya/);
  assert.match(String(body.system), /never a helpful assistant/);
  assert.match(String(body.system), /each call waiting|runs all at once/i, "uses the topic's misconception");
  assert.match(JSON.stringify(body.messages), /Lecturer Alex: Hello/);
  for (const banned of ["thinking", "temperature", "top_p", "top_k"]) {
    assert.ok(!(banned in body), `${banned} must not be sent`);
  }
});

test("ClaudeBrain parses an assessment returned as structured output", async () => {
  const brain = await claudeBrain();
  apiMode = "json";
  apiJson = {
    students: [{ id: "priya", delta: -4, reason: "jargon" }],
    next_speaker: "none",
    intent: "",
    moments: [{ student_id: "priya", kind: "missed_signal", note: "said she was fine" }],
    abusive: false,
  };
  const result = await brain.assess({
    config: DEFAULT_CONFIG,
    students: [{ persona: priya, score: 20, quietTurns: 3 }],
    transcript,
    latest: transcript[0],
    screen: null,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result.deltas, { priya: -4 });
  assert.equal(result.nextSpeakerId, null);
  assert.equal(result.moments[0].studentId, "priya");
  const format = (captured[0].body.output_config as { format: { type: string } }).format;
  assert.equal(format.type, "json_schema");
});

test("ClaudeBrain reports a rejected key as a fatal error", async () => {
  const brain = await claudeBrain();
  apiMode = "deny";
  await assert.rejects(
    async () => {
      for await (const delta of brain.generate(studentRequest())) void delta;
    },
    (error: unknown) => error instanceof BrainError && error.kind === "fatal",
  );
});

test("a student's prompt carries their current understanding", () => {
  const prompt = buildStudentTurn(studentRequest());
  assert.match(prompt, /you're lost \(20\/100\)/);
});
