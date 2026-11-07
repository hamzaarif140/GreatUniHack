/**
 * The contract between the classroom UI and the Node.js server.
 * Every message is plain JSON and is shared by both sides.
 */

export type ParticipantStatus = "idle" | "listening" | "thinking" | "speaking";

export interface Participant {
  id: string;
  name: string;
  kind: "human" | "agent";
  /** Avatar colour. The tile background is derived from it. */
  color: string;
  /** Short background, shown for students. */
  role?: string;
  muted: boolean;
  cameraOn: boolean;
  /** Timestamp the hand went up, or null. Used to order raised hands. */
  handRaisedAt: number | null;
  status: ParticipantStatus;
}

/** A student who can be in the class, whether or not they are right now. */
export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: number;
}

export interface Caption {
  speakerId: string;
  text: string;
  /** False while the sentence is still arriving. */
  final: boolean;
}

/** "live" students are answered by a model; "simulated" ones use scripted text. */
export type AgentEngine = "live" | "simulated";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

export type Difficulty = "cooperative" | "typical" | "chaotic";

export interface ClassConfig {
  topic: string;
  difficulty: Difficulty;
}

export type ClassPhase = "live" | "ended";

export interface CoachTip {
  id: string;
  message: string;
  at: number;
}

/** A line a student is saying now, for the browser to play. */
export interface SpeechCue {
  id: string;
  speakerId: string;
  text: string;
  /** Where to stream a hosted voice from. Null means use the browser's own voices. */
  audioPath: string | null;
}

export type LocalUser = Pick<Participant, "id" | "name" | "color">;

export type LocalPatch = Partial<
  Pick<Participant, "muted" | "cameraOn" | "handRaisedAt" | "status">
>;

export interface TranscriptLine {
  id: string;
  /** Milliseconds since class started. */
  at: number;
  speakerId: string;
  speakerName: string;
  role: "lecturer" | "student";
  channel: "spoken" | "chat";
  text: string;
}

export interface ScorePoint {
  at: number;
  score: number;
}

export interface DebriefStudent {
  id: string;
  name: string;
  role: string;
  history: ScorePoint[];
  turns: number;
  words: number;
}

export interface DebriefQuestion {
  lineId: string;
  text: string;
  kind: "open" | "closed";
}

/** One piece of feedback, tied to the moment in the transcript it refers to. */
export interface DebriefPoint {
  text: string;
  lineId: string | null;
}

export interface DebriefNarrative {
  summary: string;
  strengths: DebriefPoint[];
  missedSignals: DebriefPoint[];
  improvements: DebriefPoint[];
}

export interface Debrief extends DebriefNarrative {
  config: ClassConfig;
  durationMs: number;
  lecturerName: string;
  lecturerWords: number;
  students: DebriefStudent[];
  questions: DebriefQuestion[];
  transcript: TranscriptLine[];
  /** "claude" when a model wrote the feedback, "rules" when simple rules did. */
  feedbackSource: "claude" | "rules";
}

/** Everything a client needs on joining or reconnecting. Replaces earlier state. */
export interface MeetingSnapshot {
  /** Everyone except the receiving client. */
  participants: Participant[];
  messages: ChatMessage[];
  catalog: AgentProfile[];
  hostId: string;
  engine: AgentEngine;
  /** The server can provide tokens for live speech recognition. */
  liveTranscription: boolean;
  config: ClassConfig;
  phase: ClassPhase;
  /** The next three are only sent to the lecturer, and are empty for anyone else. */
  scores: Record<string, number>;
  tips: CoachTip[];
  debrief: Debrief | null;
}

/** Backend -> UI */
export type ServerEvent =
  | ({ type: "snapshot" } & MeetingSnapshot)
  | { type: "host"; id: string }
  | { type: "participant.joined"; participant: Participant }
  | { type: "participant.left"; id: string }
  | { type: "participant.updated"; id: string; patch: Partial<Participant> }
  | ({ type: "caption" } & Caption)
  | { type: "speech"; cue: SpeechCue }
  /** The student was cut off, so stop playing them now. */
  | { type: "speech.stop" }
  /** A single-use token for live transcription, or null if one couldn't be issued. */
  | { type: "stt.token"; token: string | null }
  | { type: "chat.message"; message: ChatMessage }
  | { type: "reaction"; senderId: string; emoji: string }
  /** Something the user should be told, such as a refused action. */
  | { type: "notice"; message: string }
  | { type: "class.scores"; scores: Record<string, number> }
  | { type: "class.coach"; tip: CoachTip }
  | { type: "class.phase"; phase: ClassPhase }
  | { type: "class.debrief"; debrief: Debrief };

/** Produced by the transport on the client, never sent by the server. */
export type TransportEvent = ServerEvent | { type: "connection"; status: ConnectionStatus };

/** The first message on a socket. */
export interface ClientHello {
  type: "hello";
  meetingCode: string;
  user: LocalUser;
  /** Applied by whoever arrives first, who becomes the lecturer. */
  config?: ClassConfig;
}

/** UI -> backend */
export type ClientCommand =
  | { type: "class.say"; text: string }
  | { type: "class.end" }
  | { type: "stt.token" }
  /** What the lecturer is sharing now, as a base64 JPEG. */
  | { type: "screen.frame"; data: string }
  | { type: "screen.stop" }
  | { type: "chat.send"; text: string }
  | { type: "reaction.send"; emoji: string }
  | { type: "local.update"; patch: LocalPatch }
  | { type: "agent.invite"; agentId: string }
  | { type: "agent.remove"; id: string }
  | { type: "agent.setMuted"; id: string; muted: boolean }
  /** Call on a student whose hand is up, so they say what they raised it for. */
  | { type: "agent.callOn"; id: string }
  | { type: "agents.muteAll" };
