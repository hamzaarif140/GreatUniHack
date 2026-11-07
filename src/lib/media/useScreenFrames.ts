"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ClientCommand } from "../meeting/types";

const CHECK_EVERY_MS = 1500;
/** Sent now and then even when nothing changed, so a reconnected server catches up. */
const RESEND_EVERY_MS = 20_000;
const MAX_WIDTH = 1280;
const SMALL_WIDTH = 960;
/** Base64 characters. Must stay under the server's limit. */
const MAX_FRAME_SIZE = 900_000;
const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 36;
/** Average colour change, out of 255, that counts as new content on the screen. */
const CHANGED = 1;
/** A smaller change is still worth sending just before the lecturer speaks. */
const CHANGED_AT_ALL = 0.1;
const FLUSH_TIMEOUT_MS = 400;

/* ImageCapture isn't in TypeScript's standard types. */
interface FrameGrabber {
  grabFrame(): Promise<ImageBitmap>;
}
type FrameGrabberConstructor = new (track: MediaStreamTrack) => FrameGrabber;

function encode(source: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  for (const [width, quality] of [[MAX_WIDTH, 0.75], [SMALL_WIDTH, 0.6]] as const) {
    const scale = Math.min(1, width / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", quality).split(",")[1];
    if (data && data.length <= MAX_FRAME_SIZE) return data;
  }
  return null;
}

/** Sends what's being shared to the class server, whenever it changes. */
export function useScreenFrames(
  stream: MediaStream | null,
  enabled: boolean,
  send: (command: ClientCommand) => void,
) {
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || !enabled) return;

    // ImageCapture keeps working when the shared window hides this tab. A video element may not.
    const Grabber = (window as unknown as { ImageCapture?: FrameGrabberConstructor }).ImageCapture;
    const grabber = Grabber ? new Grabber(track) : null;
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    void video.play().catch(() => {});

    const thumb = document.createElement("canvas");
    thumb.width = THUMB_WIDTH;
    thumb.height = THUMB_HEIGHT;
    const thumbContext = thumb.getContext("2d", { willReadFrequently: true });

    let lastPixels: Uint8ClampedArray | null = null;
    let lastSentAt = 0;
    let busy = false;
    let active = true;

    const capture = async (threshold: number) => {
      if (busy || !active || !thumbContext) return;
      busy = true;
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = grabber ? await grabber.grabFrame().catch(() => null) : null;
        const source: CanvasImageSource | null = bitmap ?? (video.readyState >= 2 ? video : null);
        const width = bitmap?.width ?? video.videoWidth;
        const height = bitmap?.height ?? video.videoHeight;
        if (!source || !width || !height || !active) return;

        thumbContext.drawImage(source, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        const pixels = thumbContext.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data;
        let difference = Infinity;
        if (lastPixels) {
          let sum = 0;
          for (let i = 0; i < pixels.length; i++) sum += Math.abs(pixels[i] - lastPixels[i]);
          difference = sum / pixels.length;
        }
        const now = Date.now();
        if (difference < threshold && now - lastSentAt < RESEND_EVERY_MS) return;

        const data = encode(source, width, height);
        if (!data) return;
        send({ type: "screen.frame", data });
        lastPixels = pixels;
        lastSentAt = now;
      } finally {
        bitmap?.close();
        busy = false;
      }
    };

    void capture(CHANGED);
    const interval = setInterval(() => void capture(CHANGED), CHECK_EVERY_MS);
    flushRef.current = () => capture(CHANGED_AT_ALL);

    return () => {
      active = false;
      clearInterval(interval);
      flushRef.current = async () => {};
      video.srcObject = null;
      send({ type: "screen.stop" });
    };
  }, [stream, enabled, send]);

  /** Makes sure the class has the current screen, without holding up the conversation long. */
  const flush = useCallback(
    () =>
      Promise.race([
        flushRef.current(),
        new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
      ]),
    [],
  );

  return { flush };
}
