import type {
  DebriefNarrative,
  DebriefPoint,
  DebriefQuestion,
  DebriefStudent,
  TranscriptLine,
} from "../src/lib/meeting/types";
import type { Moment } from "./brain";

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const OPEN_START =
  /^(how|why|what|where|when|which|who|explain|describe|tell me|walk me|talk me|could you explain|can you explain|can someone explain|can you tell|what's|how's|why's)\b/i;

/** Pulls the questions out of a line. Open ones invite more than a yes or a no. */
export function extractQuestions(line: TranscriptLine): DebriefQuestion[] {
  const sentences = line.text.match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.endsWith("?"))
    .map((text) => ({
      lineId: line.id,
      text,
      // "Priya, what do you think?" is as open as "What do you think?".
      kind: OPEN_START.test(text.replace(/^[\w'-]+,\s*/, "")) ? "open" : "closed",
    }));
}

/** The next coaching whisper, if any. Fully rule-based, so tips are instant and free. */
export function coachTipFor(state: {
  latestWords: number;
  turnsWithoutQuestion: number;
  quietStudents: { name: string; quietTurns: number; score: number }[];
}) {
  const lost = state.quietStudents
    .filter((student) => student.quietTurns >= 4 && student.score < 50)
    .sort((a, b) => a.score - b.score)[0];
  if (lost) {
    return `${lost.name} hasn't spoken for your last ${lost.quietTurns} turns. It might be worth asking them directly.`;
  }
  if (state.latestWords > 120) {
    return "That was a long stretch of explanation. Try breaking it up with a question.";
  }
  if (state.turnsWithoutQuestion >= 4) {
    return `You've gone ${state.turnsWithoutQuestion} turns without checking understanding. Try an open question.`;
  }
  return null;
}

/** Feedback built only from what happened, for when no model is available to write it. */
export function rulesNarrative(input: {
  transcript: TranscriptLine[];
  students: DebriefStudent[];
  questions: DebriefQuestion[];
  moments: Moment[];
  lecturerWords: number;
}): DebriefNarrative {
  const { transcript, students, questions, moments, lecturerWords } = input;
  const studentWords = students.reduce((sum, student) => sum + student.words, 0);
  const share = Math.round((lecturerWords / Math.max(lecturerWords + studentWords, 1)) * 100);
  const open = questions.filter((question) => question.kind === "open");
  const nameOf = (id: string) => students.find((student) => student.id === id)?.name ?? "A student";

  const strengths: DebriefPoint[] = moments
    .filter((moment) => moment.kind === "breakthrough")
    .slice(0, 3)
    .map((moment) => ({
      text: `${nameOf(moment.studentId)}'s understanding rose sharply around this point.`,
      lineId: moment.lineId,
    }));
  if (open[0]) {
    strengths.push({ text: `You asked an open question: "${open[0].text}"`, lineId: open[0].lineId });
  }

  const missedSignals: DebriefPoint[] = moments
    .filter((moment) => moment.kind !== "breakthrough")
    .slice(0, 4)
    .map((moment) => ({
      text: `${nameOf(moment.studentId)}: ${moment.note}`,
      lineId: moment.lineId,
    }));

  const firstLine = transcript.find((line) => line.role === "lecturer")?.id ?? null;
  const improvements: DebriefPoint[] = [];
  if (share > 80) {
    improvements.push({
      text: `You did ${share}% of the talking. Pause more often to let students respond.`,
      lineId: firstLine,
    });
  }
  if (open.length === 0) {
    improvements.push({
      text: "You didn't ask any open questions. Try \"how would you...\" or \"why does...\" to see what students really think.",
      lineId: firstLine,
    });
  }
  const silent = students.filter((student) => student.turns === 0).map((student) => student.name);
  if (silent.length > 0) {
    improvements.push({
      text: `${silent.join(" and ")} never spoke. Try inviting students in by name.`,
      lineId: firstLine,
    });
  }

  return {
    summary:
      transcript.length === 0
        ? "Nothing was said in this class, so there's nothing to review yet."
        : `You spoke ${lecturerWords} words and asked ${questions.length} question${questions.length === 1 ? "" : "s"}, ${open.length} of them open.`,
    strengths,
    missedSignals,
    improvements: improvements.slice(0, 3),
  };
}
