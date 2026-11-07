"use client";

import { useEffect, useRef } from "react";

interface VideoStreamProps {
  stream: MediaStream;
  mirrored?: boolean;
  fit?: "cover" | "contain";
  label: string;
}

export function VideoStream({ stream, mirrored, fit = "cover", label }: VideoStreamProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label={label}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: fit,
        transform: mirrored ? "scaleX(-1)" : undefined,
      }}
    />
  );
}
