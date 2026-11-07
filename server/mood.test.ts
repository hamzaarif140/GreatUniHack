import assert from "node:assert/strict";
import test from "node:test";
import { moodFor } from "../src/lib/meeting/mood";

test("moods follow understanding, and a sudden change shows first", () => {
  assert.equal(moodFor("priya", undefined), null);
  assert.equal(moodFor("priya", 10)?.emoji, "😞");
  assert.equal(moodFor("priya", 30)?.emoji, "😕");
  assert.equal(moodFor("priya", 50)?.emoji, "🤔");
  assert.equal(moodFor("priya", 70)?.emoji, "🙂");
  assert.equal(moodFor("priya", 90)?.emoji, "😄");
  assert.equal(moodFor("priya", 50, 8)?.emoji, "😃", "a breakthrough");
  assert.equal(moodFor("priya", 50, -8)?.emoji, "😟", "just got lost");
});

test("only the most able student gets bored once they've got it", () => {
  assert.equal(moodFor("samira", 85)?.emoji, "🥱");
  assert.equal(moodFor("samira", 85, 3)?.emoji, "😄", "still learning something");
  assert.equal(moodFor("ana", 85)?.emoji, "😄");
});
