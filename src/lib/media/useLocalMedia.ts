"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaDevices {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}

type Kind = "mic" | "cam" | "screen";

function describeError(error: unknown, device: string) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return `${device} access was blocked. Allow it in your browser's site settings and try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `No ${device.toLowerCase()} was found on this device.`;
  }
  if (name === "NotReadableError") {
    return `Your ${device.toLowerCase()} is being used by another app.`;
  }
  return `Couldn't start your ${device.toLowerCase()}.`;
}

/** Owns the real microphone, camera and screen-share streams for this tab. */
export function useLocalMedia() {
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [rawLevel, setRawLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDevices>({ mics: [], cams: [] });
  const [micId, setMicId] = useState<string | undefined>();
  const [camId, setCamId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const streams = useRef<Record<Kind, MediaStream | null>>({ mic: null, cam: null, screen: null });
  const pending = useRef<Record<Kind, boolean>>({ mic: false, cam: false, screen: false });

  const store = useCallback((kind: Kind, stream: MediaStream | null) => {
    streams.current[kind]?.getTracks().forEach((track) => track.stop());
    streams.current[kind] = stream;
    if (kind === "mic") setMicStream(stream);
    if (kind === "cam") setCamStream(stream);
    if (kind === "screen") setScreenStream(stream);
  }, []);

  const refreshDevices = useCallback(async () => {
    const all = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    setDevices({
      mics: all.filter((d) => d.kind === "audioinput"),
      cams: all.filter((d) => d.kind === "videoinput"),
    });
  }, []);

  const acquire = useCallback(
    async (kind: "mic" | "cam", deviceId?: string) => {
      const label = kind === "mic" ? "Microphone" : "Camera";
      if (pending.current[kind]) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(`${label} access needs HTTPS or localhost.`);
        return;
      }
      pending.current[kind] = true;
      setError(null);
      try {
        const device = deviceId ? { deviceId: { exact: deviceId } } : {};
        const stream = await navigator.mediaDevices.getUserMedia(
          kind === "mic"
            ? // Echo cancellation stops students' voices coming back in through the mic.
              { audio: { ...device, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
            : { video: deviceId ? device : true },
        );
        store(kind, stream);
        void refreshDevices();
      } catch (err) {
        setError(describeError(err, label));
      } finally {
        pending.current[kind] = false;
      }
    },
    [store, refreshDevices],
  );

  const toggleMic = useCallback(() => {
    if (streams.current.mic) store("mic", null);
    else void acquire("mic", micId);
  }, [acquire, micId, store]);

  const toggleCam = useCallback(() => {
    if (streams.current.cam) store("cam", null);
    else void acquire("cam", camId);
  }, [acquire, camId, store]);

  const selectMic = useCallback(
    (id: string) => {
      setMicId(id);
      if (streams.current.mic) void acquire("mic", id);
    },
    [acquire],
  );

  const selectCam = useCallback(
    (id: string) => {
      setCamId(id);
      if (streams.current.cam) void acquire("cam", id);
    },
    [acquire],
  );

  const stopScreenShare = useCallback(() => store("screen", null), [store]);

  const startScreenShare = useCallback(async () => {
    if (pending.current.screen) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing isn't available in this browser.");
      return;
    }
    pending.current.screen = true;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // Fires when the user clicks the browser's own "Stop sharing" button.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streams.current.screen === stream) store("screen", null);
      });
      store("screen", stream);
    } catch (err) {
      // Closing the picker also lands here and is not an error worth showing.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
        setError("Couldn't start screen sharing.");
      }
    } finally {
      pending.current.screen = false;
    }
  }, [store]);

  const stopAll = useCallback(() => {
    store("mic", null);
    store("cam", null);
    store("screen", null);
    setError(null);
  }, [store]);

  const clearError = useCallback(() => setError(null), []);

  // Turns the mic signal into a 0-3 level for the speaking indicators.
  useEffect(() => {
    if (!micStream) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(micStream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let smoothed = 0;

    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }
      smoothed = Math.max(Math.sqrt(sum / samples.length), smoothed * 0.8);
      setRawLevel(smoothed < 0.02 ? 0 : smoothed < 0.06 ? 1 : smoothed < 0.14 ? 2 : 3);
    }, 100);

    return () => {
      clearInterval(interval);
      void context.close();
    };
  }, [micStream]);

  // Never leave the camera light on after leaving the page. Next.js can keep a route
  // alive while hidden, so state is cleared too or returning would show dead streams.
  useEffect(() => {
    return () => {
      store("mic", null);
      store("cam", null);
      store("screen", null);
    };
  }, [store]);

  return {
    micOn: micStream !== null,
    camOn: camStream !== null,
    micStream,
    camStream,
    screenStream,
    micLevel: micStream ? rawLevel : 0,
    devices,
    micId: micId ?? micStream?.getAudioTracks()[0]?.getSettings().deviceId,
    camId: camId ?? camStream?.getVideoTracks()[0]?.getSettings().deviceId,
    error,
    toggleMic,
    toggleCam,
    selectMic,
    selectCam,
    startScreenShare,
    stopScreenShare,
    stopAll,
    clearError,
    refreshDevices,
  };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;
