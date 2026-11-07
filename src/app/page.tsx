"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  MdCallEnd,
  MdClosedCaption,
  MdKeyboard,
  MdMic,
  MdOutlinePanTool,
  MdPresentToAll,
  MdVideoCall,
  MdVideocam,
} from "react-icons/md";
import { Brand } from "@/components/Brand";
import { Classroom } from "@/components/Classroom";
import { generateMeetingCode, parseMeetingCode } from "@/lib/identity";
import { moodFor } from "@/lib/meeting/mood";
import { STUDENTS } from "@/lib/meeting/students";
import type { Participant } from "@/lib/meeting/types";
import { useClock } from "@/lib/useClock";
import styles from "./page.module.css";

/** A moment from a class, drawn with the real classroom: one student talking, one with a hand up. */
const PREVIEW: { id: string; status?: Participant["status"]; hand?: boolean; score: number; change?: number }[] = [
  { id: "marcus", status: "speaking", score: 55 },
  { id: "ana", score: 68 },
  { id: "leo", hand: true, score: 28, change: -7 },
  { id: "priya", score: 33 },
  { id: "samira", score: 86 },
];

const PREVIEW_PEOPLE: Participant[] = [
  {
    id: "you",
    name: "Lecturer",
    kind: "human",
    color: "#0b57d0",
    muted: false,
    cameraOn: false,
    handRaisedAt: null,
    status: "idle",
  },
  ...PREVIEW.map(({ id, status, hand }) => {
    const persona = STUDENTS.find((student) => student.id === id)!;
    return {
      id,
      name: persona.name,
      kind: "agent" as const,
      color: persona.color,
      role: persona.role,
      muted: false,
      cameraOn: false,
      handRaisedAt: hand ? 1 : null,
      status: status ?? "listening",
    };
  }),
];

const PREVIEW_MOODS = Object.fromEntries(
  PREVIEW.map(({ id, score, change }) => [id, moodFor(id, score, change)!]),
);

const noop = () => {};
const silent = () => null;

export default function Home() {
  const router = useRouter();
  const clock = useClock();
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);

  function join(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMeetingCode(code);
    if (parsed) router.push(`/meet/${parsed}`);
    else setInvalid(true);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <span className={styles.clock}>{clock}</span>
      </header>

      <main className={styles.main}>
        <section className={styles.copy}>
          <h1>Practise teaching on a class of AI students</h1>
          <p>
            Step into a lecture hall of students who listen, raise their hands when they&apos;re lost, and react
            to how well you explain things. Then get a coaching debrief on what landed and what didn&apos;t.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => router.push(`/meet/${generateMeetingCode()}`)}
            >
              <MdVideoCall size={22} aria-hidden="true" />
              New class
            </button>

            <form className={styles.joinForm} onSubmit={join}>
              <label className={styles.codeField} data-invalid={invalid}>
                <MdKeyboard size={22} aria-hidden="true" />
                <input
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setInvalid(false);
                  }}
                  placeholder="Enter a code or link"
                  aria-label="Class code or link"
                  aria-invalid={invalid}
                />
              </label>
              <button type="submit" className={styles.join} disabled={!code.trim()}>
                Join
              </button>
            </form>
          </div>
          {invalid && <p className={styles.error}>That doesn&apos;t look like a class code.</p>}

        </section>

        {/* The real classroom, as a still picture: hidden from assistive tech and not interactive. */}
        <section className={styles.preview} aria-hidden="true" inert>
          <div className={styles.window}>
            <div className={styles.windowBar}>
              <span>Recursion</span>
              <span className={styles.live}>Live</span>
            </div>
            <div className={styles.hall}>
              <Classroom
                participants={PREVIEW_PEOPLE}
                localId="you"
                camStream={null}
                pinnedId={null}
                studentLevel={silent}
                micLevel={0}
                moods={PREVIEW_MOODS}
                onShowPeople={noop}
                onTogglePin={noop}
                onSetMuted={noop}
                onRemove={noop}
              />
              <div className={styles.caption}>
                <strong>Marcus</strong>
                Isn&apos;t recursion basically just a loop with extra steps?
              </div>
            </div>
            <div className={styles.controls}>
              <i>
                <MdMic />
              </i>
              <i>
                <MdVideocam />
              </i>
              <i>
                <MdPresentToAll />
              </i>
              <i>
                <MdClosedCaption />
              </i>
              <i>
                <MdOutlinePanTool />
              </i>
              <i className={styles.end}>
                <MdCallEnd />
              </i>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
