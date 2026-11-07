import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { STUDENTS } from "../src/lib/meeting/students";

const DEFAULT_MODEL = "eleven_flash_v2_5";
const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const CUE_LIFETIME_MS = 2 * 60_000;
const MAX_CUES = 200;
/** A browser can fetch one audio file more than once, but credit must stay bounded. */
const MAX_FETCHES_PER_CUE = 3;

export interface SpeechService {
  /** Registers a line to be spoken, and returns the path that streams its audio. */
  prepare(studentId: string, text: string): string;
  /** A short-lived token that lets one browser session use live transcription. */
  transcriptionToken(): Promise<string>;
}

/**
 * Used when the account's voices can't be listed, such as with a key that lacks the
 * voices_read permission. Override any of them with ELEVENLABS_VOICE_<STUDENT>.
 */
export const DEFAULT_VOICES: Record<string, string> = {
  marcus: "TX3LPaxmHKxFdv7VOQHJ",
  priya: "EXAVITQu4vr4xnSDxMaL",
  leo: "IKne3meq5aSn9XLyUdCD",
  ana: "Xb7hH8MSUJpSbSDYk0k2",
  samira: "FGY2WhTYpPnrIDTdsKH5",
};

interface Cue {
  studentId: string;
  text: string;
  expiresAt: number;
  fetches: number;
}

interface AccountVoice {
  voice_id: string;
  labels?: { gender?: string };
}

export interface ElevenLabsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Chosen voices, by student id. Any student not listed gets one from the account. */
  overrides?: Record<string, string>;
}

/** Student voices from ElevenLabs. The API key stays here, on the server. */
export class ElevenLabsVoices implements SpeechService {
  private cues = new Map<string, Cue>();
  private assigned: Promise<Record<string, string>> | null = null;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly overrides: Record<string, string>;

  constructor(options: ElevenLabsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_MODEL;
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.overrides = options.overrides ?? {};
  }

  prepare(studentId: string, text: string) {
    const now = Date.now();
    this.cues.forEach((cue, id) => {
      if (cue.expiresAt < now) this.cues.delete(id);
    });
    if (this.cues.size >= MAX_CUES) {
      const oldest = this.cues.keys().next().value;
      if (oldest) this.cues.delete(oldest);
    }
    // Unguessable, because whoever holds this path can spend credit on this one line.
    const id = randomBytes(18).toString("base64url");
    this.cues.set(id, { studentId, text, expiresAt: now + CUE_LIFETIME_MS, fetches: 0 });
    return `/speech/${id}`;
  }

  async transcriptionToken() {
    const reply = await fetch(`${this.baseUrl}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
    });
    if (!reply.ok) throw new Error(`token request failed: ElevenLabs returned ${reply.status}`);
    const { token } = (await reply.json()) as { token?: string };
    if (!token) throw new Error("token request failed: no token returned");
    return token;
  }

  /** Streams a registered line. On failure the browser falls back to its own voice. */
  async stream(id: string, response: ServerResponse) {
    const cue = this.cues.get(id);
    if (!cue || cue.expiresAt < Date.now() || cue.fetches >= MAX_FETCHES_PER_CUE) {
      response.writeHead(404).end();
      return;
    }
    cue.fetches++;

    try {
      const voices = await this.voices();
      const voiceId = voices[cue.studentId];
      if (!voiceId) throw new Error(`no voice available for ${cue.studentId}`);

      const upstream = await fetch(
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ text: cue.text, model_id: this.model }),
        },
      );
      if (!upstream.ok || !upstream.body) throw new Error(`ElevenLabs returned ${upstream.status}`);

      response.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(response);
    } catch (error) {
      console.error("[voices]", error instanceof Error ? error.message : error);
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  }

  /** Looked up once, and again after a failure, so a brief outage doesn't last all day. */
  private voices() {
    this.assigned ??= this.assignVoices().catch((error) => {
      this.assigned = null;
      throw error;
    });
    return this.assigned;
  }

  /**
   * ElevenLabs retires voices over time, so IDs aren't hardcoded. Each student gets a
   * different voice from the account, matched to the character where labels allow.
   */
  private async assignVoices() {
    const assigned: Record<string, string> = { ...this.overrides };
    if (STUDENTS.every((student) => assigned[student.id])) return assigned;

    const reply = await fetch(`${this.baseUrl}/v1/voices`, { headers: { "xi-api-key": this.apiKey } });
    if (reply.status === 401 || reply.status === 403) {
      console.warn("[voices] This key can't list voices, so students are using the default voices.");
      return { ...DEFAULT_VOICES, ...this.overrides };
    }
    if (!reply.ok) throw new Error(`couldn't list voices: ElevenLabs returned ${reply.status}`);
    const { voices } = (await reply.json()) as { voices: AccountVoice[] };

    const used = new Set(Object.values(assigned));
    const take = (gender?: string) => {
      const voice = voices.find(
        (candidate) =>
          !used.has(candidate.voice_id) && (!gender || candidate.labels?.gender?.toLowerCase() === gender),
      );
      if (voice) used.add(voice.voice_id);
      return voice?.voice_id;
    };
    for (const student of STUDENTS) {
      if (assigned[student.id]) continue;
      // If the account runs out of voices, sharing one is better than silence.
      const voiceId = take(student.voice.gender) ?? take() ?? voices[0]?.voice_id;
      if (voiceId) assigned[student.id] = voiceId;
    }
    return assigned;
  }
}
