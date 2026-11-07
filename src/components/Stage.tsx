"use client";

import { useRef, type CSSProperties } from "react";
import { MdPresentToAll } from "react-icons/md";
import type { Participant } from "@/lib/meeting/types";
import { useGridLayout } from "@/lib/useGridLayout";
import type { Mood } from "@/lib/meeting/mood";
import type { LevelReader } from "@/lib/voice/useStudentVoices";
import { Avatar } from "./Avatar";
import { Classroom } from "./Classroom";
import { ParticipantTile, type TileActions } from "./ParticipantTile";
import { VideoStream } from "./VideoStream";
import styles from "./Stage.module.css";

export type Layout = "classroom" | "tiled" | "spotlight";

const GAP = 8;

interface StageProps extends TileActions {
  participants: Participant[];
  localId: string;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  layout: Layout;
  pinnedId: string | null;
  lastSpeakerId: string | null;
  /** Loudness of each student's voice, for the classroom's speaking visualiser. */
  studentLevel: LevelReader;
  /** The local microphone level, in steps from 0 to 3. */
  micLevel: number;
  /** How each student is feeling, by id. Empty when the viewer shouldn't see it. */
  moods: Record<string, Mood>;
  /** Says whether the class can see what's being presented. */
  presentingNote: string;
  onStopPresenting: () => void;
  onShowPeople: () => void;
}

export function Stage(props: StageProps) {
  const { participants, localId, screenStream, layout, pinnedId, lastSpeakerId } = props;

  if (screenStream) {
    return (
      <div className={styles.spotlight}>
        <div className={styles.presentation}>
          <VideoStream stream={screenStream} fit="contain" label="Your shared screen" />
          <div className={styles.presentingBar}>
            <MdPresentToAll size={18} aria-hidden="true" />
            <span>{props.presentingNote}</span>
            <button type="button" onClick={props.onStopPresenting}>
              Stop presenting
            </button>
          </div>
        </div>
        <Strip {...props} people={participants} />
      </div>
    );
  }

  if (layout === "spotlight" || pinnedId) {
    const speaking = participants.find((p) => p.status === "speaking" && p.id !== localId);
    const main =
      participants.find((p) => p.id === pinnedId) ??
      speaking ??
      participants.find((p) => p.id === lastSpeakerId) ??
      participants.find((p) => p.id !== localId) ??
      participants[0];
    return (
      <div className={styles.spotlight}>
        <MainTile {...props} participant={main} />
        <Strip {...props} people={participants.filter((p) => p.id !== main.id)} />
      </div>
    );
  }

  if (layout === "classroom") {
    return (
      <Classroom
        participants={participants}
        localId={localId}
        camStream={props.camStream}
        pinnedId={pinnedId}
        studentLevel={props.studentLevel}
        micLevel={props.micLevel}
        moods={props.moods}
        onShowPeople={props.onShowPeople}
        onTogglePin={props.onTogglePin}
        onSetMuted={props.onSetMuted}
        onRemove={props.onRemove}
        onCallOn={props.onCallOn}
      />
    );
  }

  return <TiledGrid {...props} />;
}

function tileProps(props: StageProps, participant: Participant) {
  const isLocal = participant.id === props.localId;
  return {
    participant,
    isLocal,
    isPinned: participant.id === props.pinnedId,
    mood: props.moods[participant.id],
    stream: isLocal ? props.camStream : null,
    onTogglePin: props.onTogglePin,
    onSetMuted: props.onSetMuted,
    onRemove: props.onRemove,
    onCallOn: props.onCallOn,
  };
}

function TiledGrid(props: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { participants, onShowPeople } = props;
  const grid = useGridLayout(ref, participants.length, GAP);

  const overflowing = grid.visible < participants.length;
  const shown = overflowing ? participants.slice(0, grid.visible - 1) : [...participants];
  const hidden = overflowing ? participants.slice(grid.visible - 1) : [];

  // Whoever is talking should stay on screen when not everyone fits.
  const hiddenSpeaker = hidden.find((p) => p.status === "speaking");
  if (hiddenSpeaker && shown.length > 0) {
    const swapped = shown[shown.length - 1];
    shown[shown.length - 1] = hiddenSpeaker;
    hidden[hidden.indexOf(hiddenSpeaker)] = swapped;
  }

  const size: CSSProperties = { width: grid.width, height: grid.height };

  return (
    <div className={styles.gridArea} ref={ref}>
      {grid.ready && (
        <div
          className={styles.grid}
          style={{ gap: GAP, maxWidth: grid.cols * grid.width + (grid.cols - 1) * GAP }}
        >
          {shown.map((participant) => (
            <ParticipantTile key={participant.id} {...tileProps(props, participant)} style={size} />
          ))}
          {hidden.length > 0 && (
            <button type="button" className={styles.overflow} style={size} onClick={onShowPeople}>
              <span className={styles.overflowAvatars}>
                {hidden.slice(0, 2).map((person) => (
                  <Avatar key={person.id} name={person.name} color={person.color} size={40} />
                ))}
              </span>
              {hidden.length} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MainTile(props: StageProps & { participant: Participant }) {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useGridLayout(ref, 1, GAP);
  return (
    <div className={styles.main} ref={ref}>
      {grid.ready && (
        <ParticipantTile
          {...tileProps(props, props.participant)}
          style={{ width: grid.width, height: grid.height }}
        />
      )}
    </div>
  );
}

function Strip(props: StageProps & { people: Participant[] }) {
  return (
    <div className={styles.strip}>
      {props.people.map((participant) => (
        <ParticipantTile
          key={participant.id}
          {...tileProps(props, participant)}
          style={{ width: "var(--strip-tile-width)", aspectRatio: "16 / 9" }}
        />
      ))}
    </div>
  );
}
