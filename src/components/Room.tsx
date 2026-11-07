"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { colorForName } from "@/lib/identity";
import { useLocalMedia } from "@/lib/media/useLocalMedia";
import { DEFAULT_CONFIG } from "@/lib/meeting/students";
import type { ClassConfig, LocalUser } from "@/lib/meeting/types";
import { Lobby } from "./Lobby";
import { MeetingRoom } from "./MeetingRoom";
import styles from "./Room.module.css";

const NAME_KEY = "roundtable.displayName";

function readSavedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage can be blocked. The name just won't be remembered next time.
  }
}

type Phase = "lobby" | "call" | "left";

export function Room({ code }: { code: string }) {
  const media = useLocalMedia();
  const [phase, setPhase] = useState<Phase>("lobby");
  const [name, setName] = useState(readSavedName);
  const [config, setConfig] = useState<ClassConfig>(DEFAULT_CONFIG);
  // Other people in the meeting see this id, so each tab needs its own.
  const [userId] = useState(() => `user-${crypto.getRandomValues(new Uint32Array(2)).join("")}`);

  const displayName = name.trim();
  const localUser = useMemo<LocalUser>(
    () => ({ id: userId, name: displayName, color: colorForName(displayName) }),
    [userId, displayName],
  );

  if (phase === "lobby") {
    return (
      <Lobby
        code={code}
        name={name}
        onNameChange={setName}
        config={config}
        onConfigChange={setConfig}
        media={media}
        onJoin={() => {
          saveName(displayName);
          setPhase("call");
        }}
      />
    );
  }

  if (phase === "call") {
    return (
      <MeetingRoom
        code={code}
        localUser={localUser}
        config={config}
        media={media}
        onLeave={() => {
          media.stopAll();
          setPhase("left");
        }}
      />
    );
  }

  return (
    <main className={styles.left}>
      <h1>You left the class</h1>
      <div className={styles.leftActions}>
        <button type="button" className={styles.rejoin} onClick={() => setPhase("lobby")}>
          Rejoin
        </button>
        <Link href="/" className={styles.home}>
          Return to home screen
        </Link>
      </div>
    </main>
  );
}
