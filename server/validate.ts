import { DEFAULT_CONFIG, DIFFICULTIES } from "../src/lib/meeting/students";
import type {
  ClassConfig,
  ClientCommand,
  ClientHello,
  LocalPatch,
  ParticipantStatus,
} from "../src/lib/meeting/types";

/* Everything from a socket is untrusted, so it is checked field by field here. */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isShortString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const STATUSES: ParticipantStatus[] = ["idle", "listening", "thinking", "speaking"];
const MAX_TOPIC_LENGTH = 80;

export const MAX_FRAME_SIZE = 1_000_000;

/** Base64 of a JPEG always starts with "/9j/". This goes to the model, so it's checked. */
function isJpegFrame(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_FRAME_SIZE &&
    value.startsWith("/9j/") &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function parseConfig(value: unknown): ClassConfig | undefined {
  if (!isObject(value)) return undefined;
  // The topic ends up in prompts, so it must stay short and on one line.
  const topic = typeof value.topic === "string" ? oneLine(value.topic).slice(0, MAX_TOPIC_LENGTH) : "";
  const difficulty = DIFFICULTIES.find((d) => d.id === value.difficulty)?.id ?? DEFAULT_CONFIG.difficulty;
  return { topic: topic || DEFAULT_CONFIG.topic, difficulty };
}

export function parseHello(value: unknown): ClientHello | null {
  if (!isObject(value) || value.type !== "hello" || !isObject(value.user)) return null;
  const { meetingCode, user } = value;
  if (!isShortString(meetingCode, 64) || !CODE.test(meetingCode)) return null;
  if (!isShortString(user.id, 64) || !isShortString(user.name, 60)) return null;
  if (typeof user.color !== "string" || !COLOR.test(user.color)) return null;
  const name = oneLine(user.name);
  if (!name) return null;
  return {
    type: "hello",
    meetingCode,
    user: { id: user.id, name, color: user.color },
    config: parseConfig(value.config),
  };
}

function parseLocalPatch(value: unknown): LocalPatch | null {
  if (!isObject(value)) return null;
  const patch: LocalPatch = {};
  if (typeof value.muted === "boolean") patch.muted = value.muted;
  if (typeof value.cameraOn === "boolean") patch.cameraOn = value.cameraOn;
  if (value.handRaisedAt === null || typeof value.handRaisedAt === "number") {
    patch.handRaisedAt = value.handRaisedAt;
  }
  if (STATUSES.includes(value.status as ParticipantStatus)) {
    patch.status = value.status as ParticipantStatus;
  }
  return patch;
}

export function parseCommand(value: unknown): ClientCommand | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "class.say":
    case "chat.send":
      return typeof value.text === "string" ? { type: value.type, text: value.text } : null;
    case "class.end":
    case "stt.token":
    case "screen.stop":
      return { type: value.type };
    case "screen.frame":
      return isJpegFrame(value.data) ? { type: value.type, data: value.data } : null;
    case "reaction.send":
      return isShortString(value.emoji, 16) ? { type: value.type, emoji: value.emoji } : null;
    case "local.update": {
      const patch = parseLocalPatch(value.patch);
      return patch ? { type: value.type, patch } : null;
    }
    case "agent.invite":
      return isShortString(value.agentId, 64) ? { type: value.type, agentId: value.agentId } : null;
    case "agent.remove":
    case "agent.callOn":
      return isShortString(value.id, 64) ? { type: value.type, id: value.id } : null;
    case "agent.setMuted":
      return isShortString(value.id, 64) && typeof value.muted === "boolean"
        ? { type: value.type, id: value.id, muted: value.muted }
        : null;
    case "agents.muteAll":
      return { type: value.type };
    default:
      return null;
  }
}
