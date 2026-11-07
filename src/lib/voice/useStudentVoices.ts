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

/** Plays each student's line. Captions carry on regardless, so audio can fail quietly. */
export function useStudentVoices(cue: SpeechCue | null, enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Turning voices back on shouldn't repeat a line that was already said.
  const lastCueId = useRef<string | null>(null);
  /** True while a voice may be audible. The mic is gated on this. */
  const playing = useRef(false);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markEnded = useCallback(() => {
    if (tailTimer.current) clearTimeout(tailTimer.current);
    tailTimer.current = setTimeout(() => {
      playing.current = false;
    }, ECHO_TAIL_MS);
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      // Detach first, so stopping on purpose doesn't count as a failure to fall back from.
      audioRef.current.onerror = null;
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (tailTimer.current) clearTimeout(tailTimer.current);
    playing.current = false;
  }, []);

  useEffect(() => {
    if (!cue) {
      stop();
      return;
    }
    if (!enabled || lastCueId.current === cue.id) return;
    lastCueId.current = cue.id;
    if (tailTimer.current) clearTimeout(tailTimer.current);
    playing.current = true;

    if (cue.audioPath) {
      const audio = new Audio(serverHttpUrl(cue.audioPath));
      audioRef.current = audio;
      const fallBack = () => {
        if (audioRef.current === audio) speakWithBrowser(cue, markEnded);
      };
      audio.onended = markEnded;
      audio.onerror = fallBack;
      audio.play().catch(fallBack);
    } else {
      speakWithBrowser(cue, markEnded);
    }
  }, [cue, enabled, stop, markEnded]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => stop, [stop]);

  return { stop, playing };
}
