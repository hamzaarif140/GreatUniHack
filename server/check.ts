/**
 * Makes one small real call to each service, and reports how long it took.
 * Run with `npm run check`. It costs a fraction of a cent and never prints a key.
 */
import { STUDENTS, DEFAULT_CONFIG } from "../src/lib/meeting/students";
import type { TranscriptLine } from "../src/lib/meeting/types";
import { ClaudeBrain, DEFAULT_MODEL } from "./claudeBrain";
import { DEFAULT_VOICES } from "./voices";

const line: TranscriptLine = {
  id: "t1",
  at: 0,
  speakerId: "lecturer",
  speakerName: "Lecturer",
  role: "lecturer",
  channel: "spoken",
  text: "Recursion is when a function calls itself, a bit like opening nested boxes. Priya, does that make sense?",
};

async function attempt(label: string, run: () => Promise<string>) {
  const start = Date.now();
  try {
    const detail = await run();
    console.log(`PASS  ${label} (${Date.now() - start}ms): ${detail}`);
  } catch (error) {
    console.log(`FAIL  ${label} (${Date.now() - start}ms): ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

async function main() {
  const brain = new ClaudeBrain({ model: process.env.AGENT_MODEL || DEFAULT_MODEL });
  const priya = STUDENTS.find((student) => student.id === "priya")!;
  const student = { persona: priya, score: 30, quietTurns: 2 };
  const signal = new AbortController().signal;

  // Twice, because the first use of a response format is slower than later ones.
  for (const round of ["first", "second"]) {
    await attempt(`Claude assess, ${round} (${process.env.AGENT_MODEL || DEFAULT_MODEL})`, async () => {
      const result = await brain.assess({
        config: DEFAULT_CONFIG,
        students: [student],
        transcript: [line],
        latest: line,
        screen: null,
        signal,
      });
      return `next speaker ${result.nextSpeakerId}, deltas ${JSON.stringify(result.deltas)}`;
    });
  }

  await attempt("Claude student reply", async () => {
    let text = "";
    for await (const delta of brain.generate({
      student,
      config: DEFAULT_CONFIG,
      transcript: [line],
      roster: ["Lecturer", "Priya"],
      channel: "spoken",
      intent: "asked directly",
      screen: null,
      signal,
    })) {
      text += delta;
    }
    return text;
  });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.log("SKIP  ElevenLabs: no ELEVENLABS_API_KEY");
    return;
  }
  const headers = { "xi-api-key": key };

  for (const [studentId, voiceId] of Object.entries(DEFAULT_VOICES)) {
    await attempt(`ElevenLabs voice for ${studentId}`, async () => {
      const start = Date.now();
      const reply = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ text: "I think so.", model_id: "eleven_flash_v2_5" }),
        },
      );
      if (!reply.ok) throw new Error(`status ${reply.status}: ${(await reply.text()).slice(0, 200)}`);
      const firstByte = Date.now() - start;
      return `first audio after ${firstByte}ms, ${(await reply.arrayBuffer()).byteLength} bytes`;
    });
  }

  await attempt("ElevenLabs live transcription token", async () => {
    const reply = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers,
    });
    if (!reply.ok) throw new Error(`status ${reply.status}: ${(await reply.text()).slice(0, 200)}`);
    const { token } = (await reply.json()) as { token?: string };
    return token ? "token issued" : "no token in reply";
  });
}

void main();
