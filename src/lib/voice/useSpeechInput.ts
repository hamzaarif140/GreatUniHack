"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* The Web Speech API isn't in TypeScript's standard types, so this covers what's used. */
interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionClass() {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings, or type instead.",
  "service-not-allowed": "Speech recognition isn't allowed in this browser. You can type instead.",
  "audio-capture": "No microphone was found. You can type instead.",
  network: "Speech recognition couldn't reach its service. You can type instead.",
};

interface SpeechInputOptions {
  /** The words so far, updated while the person talks. */
  onInterim: (text: string) => void;
  /** Everything said, once they've let go. Empty if nothing was heard. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

/** Push-to-talk, using the browser's own speech recognition. Nothing is recorded here. */
export function useSpeechInput(options: SpeechInputOptions) {
  const [supported] = useState(() => recognitionClass() !== null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const callbacks = useRef(options);

  useEffect(() => {
    callbacks.current = options;
  });

  const start = useCallback(() => {
    const Constructor = recognitionClass();
    if (!Constructor || recognition.current) return;

    const instance = new Constructor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || "en-GB";
    let heard = "";

    instance.onresult = ({ results }) => {
      let text = "";
      for (let i = 0; i < results.length; i++) text += results[i][0].transcript;
      heard = text.trim();
      callbacks.current.onInterim(heard);
    };
    instance.onerror = ({ error }) => {
      const message = ERROR_MESSAGES[error];
      if (message) callbacks.current.onError(message);
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
      callbacks.current.onFinal(heard);
    };

    recognition.current = instance;
    setListening(true);
    try {
      instance.start();
    } catch {
      recognition.current = null;
      setListening(false);
    }
  }, []);

  // Results already in progress still arrive after this, then onend fires.
  const stop = useCallback(() => recognition.current?.stop(), []);

  useEffect(() => {
    return () => {
      const instance = recognition.current;
      if (instance) {
        instance.onend = null;
        instance.abort();
        recognition.current = null;
      }
    };
  }, []);

  return { supported, listening, start, stop };
}
