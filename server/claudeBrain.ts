import Anthropic from "@anthropic-ai/sdk";
import type { DebriefNarrative } from "../src/lib/meeting/types";
import {
  BrainError,
  type AgentBrain,
  type AssessRequest,
  type Assessment,
  type DebriefRequest,
  type GenerateRequest,
  type MomentKind,
} from "./brain";
import {
  ASSESS_SCHEMA,
  buildAssessPrompt,
  buildDebriefPrompt,
  buildStudentSystem,
  buildStudentTurn,
  DEBRIEF_SCHEMA,
  DEBRIEF_SYSTEM,
  ORCHESTRATOR_SYSTEM,
  withScreen,
} from "./prompt";

export const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT = "low";

/* Deliberate cost caps. Students say a sentence or two. These include thinking. */
const STUDENT_MAX_TOKENS = 2000;
const ASSESS_MAX_TOKENS = 4000;
const DEBRIEF_MAX_TOKENS = 16000;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeBrainOptions {
  client?: Anthropic;
  model?: string;
  effort?: Effort;
}

/** Students and a coach run by Claude. */
export class ClaudeBrain implements AgentBrain {
  readonly engine = "live";
  readonly metered = true;
  private client: Anthropic;
  private model: string;
  private effort: Effort;

  constructor(options: ClaudeBrainOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? DEFAULT_EFFORT;
  }

  /**
   * Live conversation can't wait for deliberation, so the fast model answers directly.
   * Haiku allows this at low effort, and these calls use no tools.
   */
  private get speed() {
    return /^claude-haiku/.test(this.model) ? { thinking: { type: "disabled" as const } } : {};
  }

  /** On a safety decline, the API re-runs the request on a fallback model. Haiku can't. */
  private get fallback() {
    return /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(this.model)
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {};
  }

  async assess(request: AssessRequest): Promise<Assessment> {
    const output = await this.structured<{
      students: { id: string; delta: number; reason: string }[];
      next_speaker: string;
      intent: string;
      moments: { student_id: string; kind: MomentKind; note: string }[];
      abusive: boolean;
    }>({
      system: ORCHESTRATOR_SYSTEM,
      content: withScreen(request.screen, buildAssessPrompt(request)),
      schema: ASSESS_SCHEMA,
      maxTokens: ASSESS_MAX_TOKENS,
      effort: this.effort,
      signal: request.signal,
    });

    return {
      deltas: Object.fromEntries(output.students.map((student) => [student.id, student.delta])),
      reasons: Object.fromEntries(output.students.map((student) => [student.id, student.reason])),
      nextSpeakerId: output.next_speaker === "none" ? null : output.next_speaker,
      intent: output.intent,
      moments: output.moments.map(({ student_id, kind, note }) => ({ studentId: student_id, kind, note })),
      abusive: output.abusive,
    };
  }

  async *generate(request: GenerateRequest) {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: STUDENT_MAX_TOKENS,
          output_config: { effort: this.effort },
          ...this.speed,
          ...this.fallback,
          cache_control: { type: "ephemeral" },
          system: buildStudentSystem(request.student.persona, request.config),
          messages: [{ role: "user", content: withScreen(request.screen, buildStudentTurn(request)) }],
        },
        { signal: request.signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }

      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        console.warn(`[claude] ${request.student.persona.name}'s reply was declined this turn`);
      }
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) return;
      throw toBrainError(error);
    }
  }

  async debrief(request: DebriefRequest): Promise<DebriefNarrative> {
    const output = await this.structured<{
      summary: string;
      strengths: { text: string; line_id: string }[];
      missed_signals: { text: string; line_id: string }[];
      improvements: { text: string; line_id: string }[];
    }>({
      system: DEBRIEF_SYSTEM,
      content: buildDebriefPrompt(request),
      schema: DEBRIEF_SCHEMA,
      maxTokens: DEBRIEF_MAX_TOKENS,
      // Feedback is what the lecturer takes away, so it gets more thought than a live turn.
      effort: "medium",
      signal: request.signal,
    });

    const points = (list: { text: string; line_id: string }[]) =>
      list.map(({ text, line_id }) => ({ text, lineId: line_id }));
    return {
      summary: output.summary,
      strengths: points(output.strengths),
      missedSignals: points(output.missed_signals),
      improvements: points(output.improvements),
    };
  }

  private async structured<T>(options: {
    system: string;
    content: ReturnType<typeof withScreen>;
    schema: Record<string, unknown>;
    maxTokens: number;
    effort: Effort;
    signal: AbortSignal;
  }): Promise<T> {
    try {
      const message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: options.maxTokens,
          output_config: {
            effort: options.effort,
            format: { type: "json_schema", schema: options.schema },
          },
          ...this.speed,
          ...this.fallback,
          cache_control: { type: "ephemeral" },
          system: options.system,
          messages: [{ role: "user", content: options.content }],
        },
        { signal: options.signal },
      );

      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
        throw new BrainError("transient", `Claude stopped early (${message.stop_reason}).`);
      }
      const block = message.content.find((item) => item.type === "text");
      if (!block || block.type !== "text") {
        throw new BrainError("transient", "Claude returned no answer.");
      }
      return JSON.parse(block.text) as T;
    } catch (error) {
      // A cancelled request is expected, such as when a class ends, so it isn't logged as a failure.
      if (error instanceof BrainError || error instanceof Anthropic.APIUserAbortError) throw error;
      throw toBrainError(error);
    }
  }
}

function toBrainError(error: unknown) {
  // Details stay in the server log. Clients only ever see a generic notice.
  console.error("[claude] request failed:", error instanceof Error ? error.message : error);

  if (error instanceof Anthropic.AuthenticationError) {
    return new BrainError("fatal", "The server's Claude API key was rejected.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new BrainError("fatal", "The server's Claude API key can't use this model.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new BrainError("fatal", "The server is configured with an unknown Claude model.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new BrainError("fatal", "Claude rejected the server's request.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new BrainError("transient", "Claude is rate limiting this server.");
  }
  return new BrainError("transient", "The server couldn't reach Claude.");
}
