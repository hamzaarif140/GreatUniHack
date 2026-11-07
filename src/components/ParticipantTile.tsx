"use client";

import type { CSSProperties } from "react";
import {
  MdMic,
  MdMicOff,
  MdOutlinePanTool,
  MdPersonRemove,
  MdPushPin,
  MdOutlinePushPin,
} from "react-icons/md";
import type { Mood } from "@/lib/meeting/mood";
import type { Participant } from "@/lib/meeting/types";
import { Avatar } from "./Avatar";
import { VideoStream } from "./VideoStream";
import styles from "./ParticipantTile.module.css";

export interface TileActions {
  onTogglePin: (id: string) => void;
  onSetMuted: (id: string, muted: boolean) => void;
  onRemove: (id: string) => void;
  /** Calls on a student with a raised hand. Only the lecturer gets this. */
  onCallOn?: (id: string) => void;
}

interface ParticipantTileProps extends TileActions {
  participant: Participant;
  isLocal: boolean;
  isPinned: boolean;
  /** How a student is feeling, shown to the lecturer. */
  mood?: Mood;
  stream?: MediaStream | null;
  style?: CSSProperties;
}

export function ParticipantTile({
  participant,
  isLocal,
  isPinned,
  mood,
  stream,
  style,
  onTogglePin,
  onSetMuted,
  onRemove,
  onCallOn,
}: ParticipantTileProps) {
  const { id, name, kind, color, muted, status, handRaisedAt, role } = participant;
  const speaking = status === "speaking" && !muted;
  const thinking = status === "thinking";
  const isAgent = kind === "agent";

  return (
    <div
      className={styles.tile}
      data-speaking={speaking}
      style={{ "--c": color, ...style } as CSSProperties}
    >
      {stream ? (
        <VideoStream stream={stream} mirrored={isLocal} label={`${name}'s camera`} />
      ) : (
        <div className={styles.center}>
          <span className={styles.avatarWrap}>
            {speaking && <span className={styles.pulse} />}
            <Avatar name={name} color={color} size="var(--size)" className={styles.avatar} />
          </span>
          {thinking && (
            <span className={styles.thinking}>
              <i />
              <i />
              <i />
              <span className={styles.srOnly}>Thinking</span>
            </span>
          )}
        </div>
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

      <span className={styles.indicator}>
        {muted && (
          <span className={styles.muted} title="Muted">
            <MdMicOff aria-label="Muted" />
          </span>
        )}
        {speaking && (
          <span className={styles.bars} role="img" aria-label="Speaking">
            <i />
            <i />
            <i />
          </span>
        )}
      </span>

      {mood && (
        <span className={styles.mood} role="img" aria-label={`Feeling ${mood.label}`} title={`Feeling ${mood.label}`}>
          {mood.emoji}
        </span>
      )}

      <div className={styles.label}>
        <span className={styles.name} title={role ? `${name}, ${role}` : name}>
          {name}
        </span>
        {isAgent && <span className={styles.badge}>AI</span>}
      </div>

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
  );
}
