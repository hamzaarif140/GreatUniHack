"use client";

import { useCallback, useEffect, useRef } from "react";
import { STUDENTS } from "../meeting/students";
import { serverHttpUrl } from "../meeting/transport";
import type { SpeechCue } from "../meeting/types";

const FEMALE_NAMES = /female|zira|hazel|susan|samantha|victoria|karen|moira|tessa|serena|aria|jenny|libby|sonia/i;
const MALE_NAMES = /\bmale\b|david|mark|george|daniel|alex|fred|oliver|guy|ryan|thomas/i;
/** Stays closed briefly after a voice ends, so the mic doesn't catch the room's echo. */
const ECHO_TAIL_MS = 300;

/** Gives each student a different browser voice, matched to the character where names allow. */
function browserVoiceFor(studentId: string) {
  const index = Math.max(STUDENTS.findIndex((student) => student.id === studentId), 0);
  const english = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (english.length === 0) return undefined;
  const female = STUDENTS[index].voice.gender === "female";
  const matching = english.filter((voice) =>
    female ? FEMALE_NAMES.test(voice.name) : MALE_NAMES.test(voice.name) && !FEMALE_NAMES.test(voice.name),
  );
  const pool = matching.length > 0 ? matching : english;
  return pool[index % pool.length];
}

function speakWithBrowser(cue: SpeechCue, onEnd: () => void) {
  if (typeof speechSynthesis === "undefined") {
    onEnd();
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cue.text);
  const voice = browserVoiceFor(cue.speakerId);
  if (voice) utterance.voice = voice;
  const persona = STUDENTS.find((student) => student.id === cue.speakerId);
  utterance.pitch = persona?.voice.pitch ?? 1;
  utterance.rate = persona?.voice.rate ?? 1;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  speechSynthesis.speak(utterance);
}

/**
 * How loud a student is right now, 0-1, or null when there's no audio to measure
 * (browser voices, voices off), so the visualiser animates on its own instead.
 */
export type LevelReader = (speakerId: string) => number | null;

/** Plays each student's line. Captions carry on regardless, so audio can fail quietly. */
export function useStudentVoices(cue: SpeechCue | null, enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Turning voices back on shouldn't repeat a line that was already said.
  const lastCueId = useRef<string | null>(null);
  /** True while a voice may be audible. The mic is gated on this. */
  const playing = useRef(false);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loudness of hosted voices, for the speaking visualiser.
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const samplesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const speakerRef = useRef<string | null>(null);

  const markEnded = useCallback(() => {
    if (tailTimer.current) clearTimeout(tailTimer.current);
    tailTimer.current = setTimeout(() => {
      playing.current = false;
    }, ECHO_TAIL_MS);
  }, []);

  const disconnectSource = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
  }, []);

  /**
   * Routes a voice through an analyser. Only when the audio context is already running:
   * a suspended context would silence the voice, and hearing it matters more than the bars.
   */
  const measure = useCallback(
    (audio: HTMLAudioElement) => {
      try {
        if (typeof AudioContext === "undefined") return;
        contextRef.current ??= new AudioContext();
        const context = contextRef.current;
        if (context.state !== "running") {
          void context.resume();
          return;
        }
        if (!analyserRef.current) {
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.5;
          analyser.connect(context.destination);
          analyserRef.current = analyser;
          samplesRef.current = new Uint8Array(analyser.fftSize);
        }
        disconnectSource();
        const source = context.createMediaElementSource(audio);
        source.connect(analyserRef.current);
        sourceRef.current = source;
      } catch {
        // Measuring is optional. The voice plays normally without it.
      }
    },
    [disconnectSource],
  );

  const stop = useCallback(() => {
    if (audioRef.current) {
      // Detach first, so stopping on purpose doesn't count as a failure to fall back from.
      audioRef.current.onerror = null;
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    disconnectSource();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (tailTimer.current) clearTimeout(tailTimer.current);
    playing.current = false;
  }, [disconnectSource]);

  useEffect(() => {
    if (!cue) {
      stop();
      return;
    }
    if (!enabled || lastCueId.current === cue.id) return;
    lastCueId.current = cue.id;
    speakerRef.current = cue.speakerId;
    if (tailTimer.current) clearTimeout(tailTimer.current);
    playing.current = true;

    if (cue.audioPath) {
      // Anonymous CORS, set before the source, so the analyser is allowed to read it.
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = serverHttpUrl(cue.audioPath);
      audioRef.current = audio;
      measure(audio);
      const fallBack = () => {
        if (audioRef.current !== audio) return;
        disconnectSource();
        speakWithBrowser(cue, markEnded);
      };
      audio.onended = markEnded;
      audio.onerror = fallBack;
      audio.play().catch(fallBack);
    } else {
      disconnectSource();
      speakWithBrowser(cue, markEnded);
    }
  }, [cue, enabled, stop, markEnded, measure, disconnectSource]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(
    () => () => {
      stop();
      void contextRef.current?.close();
      contextRef.current = null;
      analyserRef.current = null;
    },
    [stop],
  );

  const level = useCallback<LevelReader>((speakerId) => {
    const analyser = analyserRef.current;
    const samples = samplesRef.current;
    if (!playing.current || speakerRef.current !== speakerId || !sourceRef.current || !analyser || !samples) {
      return null;
    }
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const v = (sample - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 3.5);
  }, []);

  return { stop, playing, level };
}
