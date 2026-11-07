"use client";

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  MdMic,
  MdMicOff,
  MdOutlinePanTool,
  MdOutlinePushPin,
  MdPersonRemove,
  MdPushPin,
} from "react-icons/md";
import type { Mood } from "@/lib/meeting/mood";
import type { Participant } from "@/lib/meeting/types";
import type { LevelReader } from "@/lib/voice/useStudentVoices";
import { initial } from "@/lib/identity";
import type { TileActions } from "./ParticipantTile";
import { VideoStream } from "./VideoStream";
import { VoiceVisualizer } from "./VoiceVisualizer";
import styles from "./Classroom.module.css";

const ROWS = 3;
const COLUMNS = 6;
/** Row scale, back to front, for a sense of depth. */
const ROW_SCALE = [0.72, 0.86, 1];
/** Where people sit, in order: spread across the room rather than packed together. */
const SEAT_ORDER: [row: number, column: number][] = [
  [2, 1], [1, 3], [2, 4], [1, 1], [0, 2], [2, 2], [1, 4], [0, 4], [2, 0],
  [1, 0], [0, 0], [2, 5], [1, 5], [0, 5], [2, 3], [1, 2], [0, 1], [0, 3],
];

interface ClassroomProps extends TileActions {
  participants: Participant[];
  localId: string;
  camStream: MediaStream | null;
  pinnedId: string | null;
  /** Loudness of a student's voice, for their visualiser. */
  studentLevel: LevelReader;
  /** The local microphone level, in steps from 0 (silent) to 3 (loud). */
  micLevel: number;
  /** How each student is feeling, by id. Empty when the viewer shouldn't see it. */
  moods: Record<string, Mood>;
  onShowPeople: () => void;
}

export function Classroom(props: ClassroomProps) {
  const { participants, localId, camStream, studentLevel, micLevel, onShowPeople } = props;
  const local = participants.find((p) => p.id === localId);
  const seated = participants.filter((p) => p.id !== localId);
  const shown = seated.slice(0, SEAT_ORDER.length);
  const extra = seated.length - shown.length;

  const seats: (Participant | null)[][] = Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));
  shown.forEach((person, i) => {
    const [row, column] = SEAT_ORDER[i];
    seats[row][column] = person;
  });

  return (
    <div className={styles.hall}>
      <div className={styles.wall} aria-hidden="true">
        <span className={styles.poster}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.board}>
          <span className={styles.tray} />
        </span>
        <span className={styles.shelf}>
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className={styles.floor} aria-hidden="true" />

      <div className={styles.tiers}>
        {seats.map((row, r) => (
          // Each row is its own layer, front rows on top, so a raised hand shows over the desk behind it.
          <div key={r} className={styles.row} style={{ "--s": ROW_SCALE[r], zIndex: r + 1 } as CSSProperties}>
            <div className={styles.seats}>
              {row.map((person, c) =>
                person ? (
                  <Seat key={person.id} {...props} person={person} getLevel={studentLevel} />
                ) : (
                  <div key={`empty-${r}-${c}`} className={styles.seat}>
                    <span className={styles.chair} aria-hidden="true" />
                  </div>
                ),
              )}
            </div>
            <div className={styles.bench} aria-hidden="true" />
          </div>
        ))}
      </div>

      {extra > 0 && (
        <button type="button" className={styles.more} onClick={onShowPeople}>
          {extra} more in the class
        </button>
      )}

      {local && <LecturerView person={local} stream={camStream} micLevel={micLevel} />}
    </div>
  );
}

function Seat({
  person,
  moods,
  pinnedId,
  getLevel,
  onTogglePin,
  onSetMuted,
  onRemove,
  onCallOn,
}: ClassroomProps & { person: Participant; getLevel: LevelReader }) {
  const { id, name, color, muted, status, handRaisedAt, role, kind } = person;
  const speaking = status === "speaking" && !muted;
  const thinking = status === "thinking";
  const isAgent = kind === "agent";
  const isPinned = pinnedId === id;
  const mood = moods[id];
  const level = useCallback(() => getLevel(id), [getLevel, id]);
  const label = [name, role, mood ? `feeling ${mood.label}` : null, handRaisedAt !== null ? "hand raised" : null, speaking ? "speaking" : thinking ? "thinking" : null, muted ? "muted" : null]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={styles.seat}
      data-speaking={speaking}
      style={{ "--c": color } as CSSProperties}
      role="group"
      aria-label={label}
    >
      <span className={styles.chair} aria-hidden="true" />
      <div className={styles.person}>
        <VoiceVisualizer active={speaking} color={color} getLevel={level} className={styles.visualizer} />
        <span className={styles.head} aria-hidden="true">
          {initial(name)}
        </span>
        <span className={styles.shoulders} aria-hidden="true" />
        {mood && (
          <span key={mood.emoji} className={styles.mood} title={`Feeling ${mood.label}`} aria-hidden="true">
            {mood.emoji}
          </span>
        )}

        {handRaisedAt !== null &&
          (onCallOn && isAgent ? (
            <button
              type="button"
              className={styles.hand}
              title={`Call on ${name}`}
              aria-label={`${name} has a hand up. Call on ${name}`}
              onClick={() => onCallOn(id)}
            >
              <MdOutlinePanTool />
            </button>
          ) : (
            <span className={styles.hand} title="Hand raised">
              <MdOutlinePanTool aria-label="Hand raised" />
            </span>
          ))}
        {thinking && (
          <span className={styles.thinking} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            aria-label={isPinned ? `Unpin ${name}` : `Pin ${name}`}
            title={isPinned ? "Unpin" : "Pin to the main view"}
            onClick={() => onTogglePin(id)}
          >
            {isPinned ? <MdPushPin /> : <MdOutlinePushPin />}
          </button>
          {isAgent && (
            <>
              <button
                type="button"
                aria-label={muted ? `Unmute ${name}` : `Mute ${name}`}
                title={muted ? "Unmute" : "Mute"}
                onClick={() => onSetMuted(id, !muted)}
              >
                {muted ? <MdMicOff /> : <MdMic />}
              </button>
              <button
                type="button"
                aria-label={`Remove ${name} from the class`}
                title="Remove from the class"
                onClick={() => onRemove(id)}
              >
                <MdPersonRemove />
              </button>
            </>
          )}
        </div>
      </div>
      <span className={styles.nameplate} title={role ? `${name}, ${role}` : name}>
        {muted && <MdMicOff aria-hidden="true" />}
        {name}
      </span>
    </div>
  );
}

function LecturerView({
  person,
  stream,
  micLevel,
}: {
  person: Participant;
  stream: MediaStream | null;
  micLevel: number;
}) {
  const levelRef = useRef(micLevel);
  useEffect(() => {
    levelRef.current = micLevel;
  }, [micLevel]);
  const level = useCallback(() => levelRef.current / 3, []);
  const speaking = person.status === "speaking" && !person.muted;
  const camera = stream && person.cameraOn;

  return (
    <div
      className={styles.lecturer}
      data-speaking={speaking}
      style={{ "--c": person.color } as CSSProperties}
    >
      {camera ? (
        <VideoStream stream={stream} mirrored label="Your camera" />
      ) : (
        <div className={styles.lecturerAvatar}>
          <VoiceVisualizer active={speaking} color="#8ab4f8" getLevel={level} className={styles.pipViz} />
          <span className={styles.pipHead} aria-hidden="true">
            {initial(person.name)}
          </span>
        </div>
      )}
      <span className={styles.lecturerName}>
        {person.muted ? <MdMicOff aria-label="Muted" /> : <MdMic aria-hidden="true" />}
        {person.name} (you)
        {speaking && (
          <span className={styles.meter} aria-hidden="true">
            {[1, 2, 3].map((step) => (
              <i key={step} data-on={micLevel >= step} />
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
