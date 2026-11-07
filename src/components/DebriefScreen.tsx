"use client";

import Link from "next/link";
import { useState, type PointerEvent } from "react";
import type { Debrief, DebriefPoint, DebriefStudent, ScorePoint } from "@/lib/meeting/types";
import { Brand } from "./Brand";
import styles from "./DebriefScreen.module.css";

function formatTime(ms: number) {
  const total = Math.max(Math.round(ms / 1000), 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function DebriefScreen({ debrief }: { debrief: Debrief }) {
  const studentWords = debrief.students.reduce((sum, student) => sum + student.words, 0);
  const totalWords = Math.max(debrief.lecturerWords + studentWords, 1);
  const open = debrief.questions.filter((question) => question.kind === "open").length;
  const lineTime = (id: string | null) => debrief.transcript.find((line) => line.id === id)?.at;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <Link href="/" className={styles.newClass}>
          Start a new class
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>
            {debrief.config.topic} · {debrief.config.difficulty} class · {formatTime(debrief.durationMs)}
          </p>
          <h1>Your class debrief</h1>
          <p className={styles.summary}>{debrief.summary}</p>
          <p className={styles.note}>
            For practice only, not a formal assessment.{" "}
            {debrief.feedbackSource === "rules"
              ? "This feedback comes from simple rules, because no AI coach was available."
              : "An AI coach wrote this feedback, and it can make mistakes."}
          </p>
        </section>

        <section>
          <h2>How understanding changed</h2>
          <div className={styles.charts}>
            {debrief.students.map((student) => (
              <StudentChart key={student.id} student={student} durationMs={debrief.durationMs} />
            ))}
          </div>
          <details className={styles.table}>
            <summary>View as a table</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Times spoken</th>
                  <th scope="col">Words</th>
                </tr>
              </thead>
              <tbody>
                {debrief.students.map((student) => (
                  <tr key={student.id}>
                    <th scope="row">{student.name}</th>
                    <td>{student.history[0]?.score}</td>
                    <td>{student.history.at(-1)?.score}</td>
                    <td>{student.turns}</td>
                    <td>{student.words}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <FeedbackList title="What worked" points={debrief.strengths} lineTime={lineTime} />
        <FeedbackList title="Signals you may have missed" points={debrief.missedSignals} lineTime={lineTime} />
        <FeedbackList title="Try next time" points={debrief.improvements} lineTime={lineTime} />

        <div className={styles.twoColumns}>
          <section>
            <h2>Who did the talking</h2>
            <ul className={styles.talk}>
              <TalkRow label={`${debrief.lecturerName} (you)`} words={debrief.lecturerWords} total={totalWords} />
              {debrief.students.map((student) => (
                <TalkRow key={student.id} label={student.name} words={student.words} total={totalWords} />
              ))}
            </ul>
          </section>

          <section>
            <h2>Your questions</h2>
            {debrief.questions.length === 0 ? (
              <p className={styles.empty}>You didn&apos;t ask any questions in this class.</p>
            ) : (
              <>
                <p className={styles.questionCount}>
                  {debrief.questions.length} asked, {open} open and {debrief.questions.length - open} closed
                </p>
                <ul className={styles.questions}>
                  {debrief.questions.map((question, index) => (
                    <li key={`${question.lineId}-${index}`}>
                      <span className={styles.chip} data-kind={question.kind}>
                        {question.kind === "open" ? "Open" : "Closed"}
                      </span>
                      <a href={`#${question.lineId}`}>{question.text}</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <section>
          <h2>Transcript</h2>
          {debrief.transcript.length === 0 ? (
            <p className={styles.empty}>Nothing was said in this class.</p>
          ) : (
            <ol className={styles.transcript}>
              {debrief.transcript.map((line) => (
                <li key={line.id} id={line.id} data-role={line.role}>
                  <time>{formatTime(line.at)}</time>
                  <div>
                    <strong>{line.role === "lecturer" ? "You" : line.speakerName}</strong>
                    <p>{line.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

function FeedbackList({
  title,
  points,
  lineTime,
}: {
  title: string;
  points: DebriefPoint[];
  lineTime: (id: string | null) => number | undefined;
}) {
  if (points.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ul className={styles.feedback}>
        {points.map((point, index) => {
          const at = lineTime(point.lineId);
          return (
            <li key={index}>
              <span>{point.text}</span>
              {point.lineId && at !== undefined && <a href={`#${point.lineId}`}>{formatTime(at)}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TalkRow({ label, words, total }: { label: string; words: number; total: number }) {
  const share = Math.round((words / total) * 100);
  return (
    <li title={`${label}: ${words} words`}>
      <span className={styles.talkLabel}>{label}</span>
      <span className={styles.talkTrack}>
        <span className={styles.talkBar} style={{ width: `${share}%` }} />
      </span>
      <span className={styles.talkValue}>{share}%</span>
    </li>
  );
}

const WIDTH = 280;
const HEIGHT = 110;
const LEFT = 24;
const RIGHT = 26;
const TOP = 8;
const BOTTOM = 18;

function StudentChart({ student, durationMs }: { student: DebriefStudent; durationMs: number }) {
  const [hover, setHover] = useState<ScorePoint | null>(null);
  const { history } = student;
  const span = Math.max(durationMs, 1);
  const x = (at: number) => LEFT + (Math.min(at, span) / span) * (WIDTH - LEFT - RIGHT);
  const y = (score: number) => TOP + (1 - score / 100) * (HEIGHT - TOP - BOTTOM);
  const last = history.at(-1);
  // A flat finish still draws to the end of the class, so all charts share a time scale.
  const path = [...history, ...(last ? [{ at: span, score: last.score }] : [])]
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.at).toFixed(1)} ${y(point.score).toFixed(1)}`)
    .join(" ");

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const viewX = ((event.clientX - box.left) / box.width) * WIDTH;
    let nearest = history[0];
    for (const point of history) {
      if (Math.abs(x(point.at) - viewX) < Math.abs(x(nearest.at) - viewX)) nearest = point;
    }
    setHover(nearest ?? null);
  }

  return (
    <figure className={styles.chart}>
      <figcaption>
        <strong>{student.name}</strong>
        <span>{student.role}</span>
      </figcaption>
      <div className={styles.plot}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${student.name}'s understanding went from ${history[0]?.score} to ${last?.score} out of 100.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} className={styles.grid} />
              <text x={LEFT - 6} y={y(tick) + 3} textAnchor="end" className={styles.axis}>
                {tick}
              </text>
            </g>
          ))}
          <text x={LEFT} y={HEIGHT - 4} className={styles.axis}>
            0:00
          </text>
          <text x={WIDTH - RIGHT} y={HEIGHT - 4} textAnchor="end" className={styles.axis}>
            {formatTime(span)}
          </text>
          <path d={path} className={styles.line} />
          {last && (
            <text x={WIDTH - RIGHT + 5} y={y(last.score) + 4} className={styles.endValue}>
              {last.score}
            </text>
          )}
          {hover && (
            <>
              <line x1={x(hover.at)} x2={x(hover.at)} y1={TOP} y2={HEIGHT - BOTTOM} className={styles.crosshair} />
              <circle cx={x(hover.at)} cy={y(hover.score)} r={4} className={styles.marker} />
            </>
          )}
        </svg>
        {hover && (
          <span
            className={styles.tooltip}
            style={{
              left: `${(x(hover.at) / WIDTH) * 100}%`,
              top: `${(y(hover.score) / HEIGHT) * 100}%`,
            }}
          >
            {formatTime(hover.at)} · {hover.score}
          </span>
        )}
      </div>
    </figure>
  );
}
