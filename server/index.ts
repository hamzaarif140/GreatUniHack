import { createMeetingServer } from "./app";
import type { AgentBrain } from "./brain";
import { ClaudeBrain, DEFAULT_MODEL } from "./claudeBrain";
import { DEFAULT_LIMITS } from "./room";
import { ScriptedBrain } from "./scriptedBrain";
import { ElevenLabsVoices } from "./voices";
import { STUDENT_IDS } from "../src/lib/meeting/students";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function chooseBrain(): AgentBrain {
  const engine = process.env.AGENT_ENGINE ?? "auto";
  const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  // "claude" also covers credentials the SDK finds by itself, such as `ant auth login`.
  if (engine === "claude" || (engine === "auto" && hasCredentials)) {
    const model = process.env.AGENT_MODEL || DEFAULT_MODEL;
    const effort = EFFORTS.find((level) => level === process.env.AGENT_EFFORT);
    console.log(`Students: live, using ${model}`);
    return new ClaudeBrain({ model, effort });
  }
  console.log("Students: scripted. Set ANTHROPIC_API_KEY in .env.local to use Claude.");
  return new ScriptedBrain();
}

function chooseVoices() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("Voices: browser built-in. Set ELEVENLABS_API_KEY in .env.local for ElevenLabs.");
    return undefined;
  }
  // For example, ELEVENLABS_VOICE_PRIYA=<voice id> picks Priya's voice.
  const overrides = Object.fromEntries(
    STUDENT_IDS.flatMap((id) => {
      const voiceId = process.env[`ELEVENLABS_VOICE_${id.toUpperCase()}`];
      return voiceId ? [[id, voiceId]] : [];
    }),
  );
  console.log("Voices: ElevenLabs");
  return new ElevenLabsVoices({ apiKey, model: process.env.ELEVENLABS_MODEL, overrides });
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = positiveInt(process.env.PORT, 4000);
// Only reachable from this computer unless HOST is set deliberately.
const host = process.env.HOST || "127.0.0.1";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createMeetingServer({
  brain: chooseBrain(),
  voices: chooseVoices(),
  allowedOrigins,
  limits: {
    ...DEFAULT_LIMITS,
    maxTurns: positiveInt(process.env.AGENT_MAX_TURNS, DEFAULT_LIMITS.maxTurns),
  },
});

server.listen(port, host).then(
  (actualPort) => console.log(`Meeting server on ws://${host}:${actualPort}`),
  (error) => {
    console.error("Couldn't start the meeting server:", error.message);
    process.exit(1);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
