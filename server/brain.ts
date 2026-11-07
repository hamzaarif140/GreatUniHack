import type { StudentPersona } from "../src/lib/meeting/students";
import type {
  ClassConfig,
  DebriefNarrative,
  DebriefQuestion,
  DebriefStudent,
  TranscriptLine,
} from "../src/lib/meeting/types";

export interface StudentState {
  persona: StudentPersona;
  /** Hidden understanding, 0-100. */
  score: number;
  /** How many of the lecturer's turns have passed since this student last spoke. */
  quietTurns: number;
}

export type MomentKind = "lost" | "breakthrough" | "misconception_uncorrected" | "missed_signal";

/** Something worth raising in the debrief, tied to a line in the transcript. */
export interface Moment {
  lineId: string;
  studentId: string;
  kind: MomentKind;
  note: string;
}

export interface AssessRequest {
  config: ClassConfig;
  students: StudentState[];
  transcript: TranscriptLine[];
  latest: TranscriptLine;
  /** What the lecturer is sharing now, as a base64 JPEG. */
  screen: string | null;
  signal: AbortSignal;
}

/** The orchestrator's verdict on one thing the lecturer said. */
export interface Assessment {
  /** Change in understanding per student id. The room clamps these. */
  deltas: Record<string, number>;
  /** Why each student's score moved. */
  reasons: Record<string, string>;
  /** Who reacts, or null for silence, since a real class doesn't answer everything. */
  nextSpeakerId: string | null;
  /** What the chosen student is reacting to. */
  intent: string;
  moments: Omit<Moment, "lineId">[];
  /** The lecturer was abusive, so they get a coaching tip. */
  abusive: boolean;
}

export interface GenerateRequest {
  student: StudentState;
  config: ClassConfig;
  transcript: TranscriptLine[];
  roster: string[];
  channel: "spoken" | "chat";
  intent: string;
  /** What the lecturer is sharing now, as a base64 JPEG. */
  screen: string | null;
  signal: AbortSignal;
}

export interface DebriefRequest {
  config: ClassConfig;
  lecturerName: string;
  transcript: TranscriptLine[];
  students: DebriefStudent[];
  questions: DebriefQuestion[];
  moments: Moment[];
  lecturerWords: number;
  /** The coach sees only the transcript, so it mustn't judge slides it can't see. */
  sharedScreen: boolean;
  signal: AbortSignal;
}

/** What drives the students. Swap this to change how the class thinks. */
export interface AgentBrain {
  readonly engine: "live" | "simulated";
  /** True when each call costs money, so the room applies its turn limit. */
  readonly metered: boolean;
  assess(request: AssessRequest): Promise<Assessment>;
  /** Streams the student's words. Ends early, without throwing, when aborted. */
  generate(request: GenerateRequest): AsyncIterable<string>;
  /** Writes the coaching feedback. */
  debrief(request: DebriefRequest): Promise<DebriefNarrative>;
}

/**
 * "fatal" will not fix itself (bad key, unknown model), so students pause.
 * "transient" is worth trying again on the next turn (rate limit, outage).
 */
export class BrainError extends Error {
  constructor(
    readonly kind: "fatal" | "transient",
    message: string,
  ) {
    super(message);
  }
}
