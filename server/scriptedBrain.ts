import type { AgentBrain, AssessRequest, Assessment, DebriefRequest, GenerateRequest } from "./brain";
import { extractQuestions, rulesNarrative, wordCount } from "./classStats";

const EXAMPLE = /\b(for example|for instance|imagine|let's say|suppose|picture|think of|like a|such as)\b/i;
const STEPS = /\b(first|then|next|finally|step|after that)\b/i;
const CHECK = /(does that make sense|do you (understand|follow)|what do you think|can (you|someone) (explain|tell)|in your own words|any questions)/i;
const JARGON =
  /\b(stack frame|call stack|tail[- ]call|asymptotic|amortized|heap|dereference|memoization|invariant|polymorphism|idempotent|abstraction|complexity class|collision resolution)\b/gi;

/**
 * Free, offline students. Rule-based scoring and scripted lines let the whole class
 * run with no API key. They react to teaching habits and don't understand the content.
 */
export class ScriptedBrain implements AgentBrain {
  readonly engine = "simulated";
  readonly metered = false;
  private cursor = new Map<string, number>();

  async assess({ students, latest }: AssessRequest): Promise<Assessment> {
    const text = latest.text;
    const jargon = text.match(JARGON)?.length ?? 0;
    const words = wordCount(text);
    const asks = extractQuestions(latest).length > 0;

    const signals: [boolean, number, string][] = [
      [EXAMPLE.test(text), 6, "used a concrete example"],
      [STEPS.test(text), 4, "broke it into steps"],
      [CHECK.test(text), 4, "checked understanding"],
      [jargon > 0, -3 * jargon, "used unexplained jargon"],
      [words > 80, -4, "explained for a long stretch"],
    ];
    const active = signals.filter(([applies]) => applies);
    const change = active.reduce((sum, [, amount]) => sum + amount, 0);
    const reason = active.map(([, , label]) => label).join(", ") || "no clear change";

    const deltas: Record<string, number> = {};
    const reasonMap: Record<string, string> = {};
    for (const { persona } of students) {
      // Beginners feel jargon most, and experienced students feel it least. Aptitude is applied by the room.
      const sensitivity = change < 0 ? 1.5 - persona.baseScore / 100 : 1;
      deltas[persona.id] = Math.round(change * sensitivity);
      reasonMap[persona.id] = reason;
    }

    return {
      deltas,
      reasons: reasonMap,
      nextSpeakerId: this.chooseSpeaker(students, asks, change),
      intent: asks ? "Answer the lecturer's question." : "React to what the lecturer just said.",
      moments: [],
      abusive: false,
    };
  }

  private chooseSpeaker(students: AssessRequest["students"], asks: boolean, change: number) {
    if (students.length === 0) return null;
    const speakers = students.filter(({ persona }) => persona.eagerness >= 0.3);
    if (speakers.length === 0) return null;
    if (asks) {
      // The eager student jumps in, unless they've only just spoken.
      const rested = speakers.filter((student) => student.quietTurns > 0);
      const pool = rested.length > 0 ? rested : speakers;
      return [...pool].sort((a, b) => b.persona.eagerness - a.persona.eagerness)[0].persona.id;
    }
    if (change < 0) {
      // Unclear teaching: the most confused student who'd say so reacts.
      return [...speakers].sort((a, b) => a.score - b.score)[0].persona.id;
    }
    // A clear statement with no question often gets silence, and that's realistic.
    return null;
  }

  async *generate({ student }: GenerateRequest) {
    const { persona, score } = student;
    const lines = score < 40 ? persona.lines.low : score < 70 ? persona.lines.mid : persona.lines.high;
    const cursor = this.cursor.get(persona.id) ?? 0;
    this.cursor.set(persona.id, cursor + 1);
    yield lines[cursor % lines.length];
  }

  async debrief(request: DebriefRequest) {
    return rulesNarrative(request);
  }
}
