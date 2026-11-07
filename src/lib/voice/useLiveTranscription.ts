"use client";

import { useEffect, useRef, type RefObject } from "react";

const SAMPLE_RATE = 16000;
const SILENCE_TO_END_TURN_SECS = 0.6;
const MAX_RETRIES = 5;
/** How loud the mic must be, and for how many 100ms frames, to count as talking over a student. */
const BARGE_IN_LEVEL = 0.15;
const BARGE_IN_FRAMES = 4;
/** Audio kept while gated, so the first word of an interruption isn't lost. */
const PRE_ROLL_FRAMES = 4;

const STOP_ERRORS = new Set(["auth_error", "quota_exceeded", "unaccepted_terms"]);

/** Collects mic audio into 100ms blocks of 16-bit samples. */
const WORKLET = `
class Frames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(${SAMPLE_RATE / 10});
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (input) {
      for (const sample of input) {
        this.frame[this.filled++] = Math.max(-1, Math.min(1, sample)) * 32767;
        if (this.filled === this.frame.length) {
          this.port.postMessage(this.frame.slice());
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("frames", Frames);
`;

function toBase64(frame: Int16Array) {
  const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  return btoa(String.fromCharCode(...bytes));
}

function loudness(frame: Int16Array) {
  let sum = 0;
  for (const sample of frame) sum += (sample / 32768) ** 2;
  return Math.sqrt(sum / frame.length);
}

/** Drops notes such as "(background noise)", which nobody actually said. */
function cleanTranscript(text: string) {
  return text.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim();
}

interface LiveTranscriptionOptions {
  stream: MediaStream | null;
  enabled: boolean;
  /** Fetches a single-use token, so the real API key never reaches the browser. */
  getToken: () => Promise<string>;
  /** True while a student is talking, so the class doesn't hear its own voices. */
  gate: RefObject<boolean>;
  onPartial: (text: string) => void;
  /** A finished turn, once the person has paused. */
  onCommit: (text: string) => void;
  /** The person spoke loudly over a student. */
  onBargeIn: () => void;
  onError: (message: string) => void;
}

/** Streams the microphone to ElevenLabs while it's on, and reports what it hears. */
export function useLiveTranscription(options: LiveTranscriptionOptions) {
  const { stream, enabled } = options;
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!stream || !enabled) return;

    let active = true;
    let socket: WebSocket | null = null;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let loudFrames = 0;
    let preRoll: Int16Array[] = [];
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));

    const sendFrame = (frame: Int16Array) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: toBase64(frame),
          commit: false,
          sample_rate: SAMPLE_RATE,
        }),
      );
    };

    const onFrame = (frame: Int16Array) => {
      if (latest.current.gate.current) {
        preRoll = [...preRoll, frame].slice(-PRE_ROLL_FRAMES);
        loudFrames = loudness(frame) > BARGE_IN_LEVEL ? loudFrames + 1 : 0;
        if (loudFrames >= BARGE_IN_FRAMES) {
          loudFrames = 0;
          latest.current.onBargeIn();
        }
        // Silence keeps the session alive without the class hearing the student's voice.
        sendFrame(new Int16Array(frame.length));
        return;
      }
      loudFrames = 0;
      if (preRoll.length > 0) {
        preRoll.forEach(sendFrame);
        preRoll = [];
      }
      sendFrame(frame);
    };

    const fail = (message: string) => {
      active = false;
      socket?.close();
      latest.current.onError(message);
    };

    const scheduleRetry = () => {
      if (!active) return;
      if (retries >= MAX_RETRIES) {
        fail("Live transcription keeps disconnecting. You can type to the class instead.");
        return;
      }
      retryTimer = setTimeout(() => void connect(), 500 * 2 ** retries++);
    };

    const connect = async () => {
      let token: string;
      try {
        token = await latest.current.getToken();
      } catch {
        scheduleRetry();
        return;
      }
      if (!active) return;

      const params = new URLSearchParams({
        model_id: "scribe_v2_realtime",
        token,
        audio_format: `pcm_${SAMPLE_RATE}`,
        commit_strategy: "vad",
        vad_silence_threshold_secs: String(SILENCE_TO_END_TURN_SECS),
      });
      const next = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`);
      socket = next;

      next.onmessage = (message) => {
        const data = JSON.parse(String(message.data)) as { message_type: string; text?: string; error?: string };
        if (data.message_type === "session_started") {
          retries = 0;
        } else if (data.message_type === "partial_transcript") {
          latest.current.onPartial(cleanTranscript(data.text ?? ""));
        } else if (data.message_type === "committed_transcript") {
          const text = cleanTranscript(data.text ?? "");
          latest.current.onPartial("");
          if (text) latest.current.onCommit(text);
        } else if (STOP_ERRORS.has(data.message_type)) {
          console.error("[transcription]", data.message_type, data.error);
          fail("ElevenLabs refused live transcription. You can type to the class instead.");
        } else if (data.error) {
          console.warn("[transcription]", data.message_type, data.error);
        }
      };
      next.onclose = () => {
        if (socket === next) scheduleRetry();
      };
    };

    const start = async () => {
      try {
        await context.audioWorklet.addModule(moduleUrl);
        if (!active) return;
        const node = new AudioWorkletNode(context, "frames");
        node.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);
        // A node only runs while it leads somewhere. The gain of zero keeps the mic out of the speakers.
        const silent = context.createGain();
        silent.gain.value = 0;
        context.createMediaStreamSource(stream).connect(node).connect(silent).connect(context.destination);
        await context.resume();
        await connect();
      } catch (error) {
        console.error("[transcription]", error);
        if (active) latest.current.onError("Couldn't start live transcription. You can type to the class instead.");
      }
    };
    void start();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      const closing = socket;
      socket = null;
      closing?.close();
      void context.close();
      URL.revokeObjectURL(moduleUrl);
      latest.current.onPartial("");
    };
  }, [stream, enabled]);
}
