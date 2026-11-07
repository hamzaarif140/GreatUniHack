"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";
import { MdKeyboard, MdVideoCall } from "react-icons/md";
import { Avatar } from "@/components/Avatar";
import { Brand } from "@/components/Brand";
import { generateMeetingCode, parseMeetingCode } from "@/lib/identity";
import { useClock } from "@/lib/useClock";
import styles from "./page.module.css";

const PREVIEW_STUDENTS = [
  { name: "Samira", color: "#5c6bc0" },
  { name: "Marcus", color: "#ef6c00", speaking: true },
  { name: "Ana", color: "#00897b" },
  { name: "Priya", color: "#8e24aa" },
];

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
            Teach a computer science topic to students who react to how you explain it, then get a
            coaching debrief.
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

        <section className={styles.preview} aria-hidden="true">
          {PREVIEW_STUDENTS.map((student) => (
            <div
              key={student.name}
              className={styles.previewTile}
              data-speaking={student.speaking}
              style={{ "--c": student.color } as CSSProperties}
            >
              <Avatar name={student.name} color={student.color} size={56} />
              <span>{student.name}</span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
