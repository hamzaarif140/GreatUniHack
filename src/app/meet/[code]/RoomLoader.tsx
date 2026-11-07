"use client";

import dynamic from "next/dynamic";

// The room depends on browser-only APIs (camera, storage, audio), so it never renders on the server.
const Room = dynamic(() => import("@/components/Room").then((module) => module.Room), {
  ssr: false,
});

export function RoomLoader({ code }: { code: string }) {
  return <Room code={code} />;
}
