import { STUDENTS } from "./students";

export interface Mood {
  emoji: string;
  /** Read out to screen readers and shown on hover. */
  label: string;
}

/** A change this big in one turn shows on a student's face straight away. */
const BIG_CHANGE = 6;

/**
 * How a student looks right now, from their hidden understanding and how it just moved.
 * It's derived from the scores, so it's only for the lecturer, like the scores themselves.
 */
export function moodFor(studentId: string, score: number | undefined, change = 0): Mood | null {
  if (score === undefined) return null;
  if (change >= BIG_CHANGE) return { emoji: "😃", label: "excited, it just clicked" };
  if (change <= -BIG_CHANGE) return { emoji: "😟", label: "worried, just lost the thread" };
  const persona = STUDENTS.find((student) => student.id === studentId);
  // A very able student who already gets it switches off when nothing new comes.
  if (persona?.aptitude === 5 && score >= 80 && change <= 0) return { emoji: "🥱", label: "bored" };
  if (score < 20) return { emoji: "😞", label: "sad, feeling lost" };
  if (score < 40) return { emoji: "😕", label: "confused" };
  if (score < 60) return { emoji: "🤔", label: "unsure" };
  if (score < 80) return { emoji: "🙂", label: "content, following along" };
  return { emoji: "😄", label: "happy, understands it" };
}
