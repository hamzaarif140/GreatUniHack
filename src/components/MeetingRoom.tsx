"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  MdClose,
  MdErrorOutline,
  MdInfoOutline,
  MdLightbulbOutline,
  MdMic,
  MdSend,
  MdVolumeOff,
  MdVolumeUp,
} from "react-icons/md";
import type { LocalMedia } from "@/lib/media/useLocalMedia";
import type { ClassConfig, LocalUser, Participant } from "@/lib/meeting/types";
import { moodFor, type Mood } from "@/lib/meeting/mood";
import { useMeeting } from "@/lib/meeting/useMeeting";
import { useClock } from "@/lib/useClock";
import { useScreenFrames } from "@/lib/media/useScreenFrames";
import { useLiveTranscription } from "@/lib/voice/useLiveTranscription";
import { useSpeechInput } from "@/lib/voice/useSpeechInput";
import { useStudentVoices } from "@/lib/voice/useStudentVoices";
import { Avatar } from "./Avatar";
import { ControlBar, type PanelId } from "./ControlBar";
import { DebriefScreen } from "./DebriefScreen";
import { SidePanel } from "./SidePanel";
import { Stage, type Layout } from "./Stage";
import styles from "./MeetingRoom.module.css";

interface MeetingRoomProps {
  code: string;
  localUser: LocalUser;
  config: ClassConfig;
  media: LocalMedia;
  onLeave: () => void;
}

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function toggleFullscreen() {
  const request = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  // Some browsers refuse full screen. Nothing else depends on it.
  request?.catch(() => {});
}

export function MeetingRoom({ code, localUser, config, media, onLeave }: MeetingRoomProps) {
  const meeting = useMeeting(code, localUser, config);
  const { send, addToast } = meeting;
  const clock = useClock();
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );

  const [panel, setPanelState] = useState<PanelId | null>(null);
  const [layout, setLayout] = useState<Layout>("classroom");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [handRaisedAt, setHandRaisedAt] = useState<number | null>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [seenMessages, setSeenMessages] = useState(0);
  const [showInsights, setShowInsights] = useState(true);
  const [draft, setDraft] = useState("");
  const [voicesOn, setVoicesOn] = useState(true);

  const isLecturer = meeting.hostId === localUser.id;
  const voices = useStudentVoices(meeting.speech, voicesOn);

  // The class looks at the screen as it is when you speak, in case it only just changed.
  const screenFrames = useScreenFrames(
    media.screenStream,
    isLecturer && meeting.phase === "live" && meeting.engine === "live",
    send,
  );
  const { flush: flushScreen } = screenFrames;
  const say = useCallback(
    async (text: string) => {
      await flushScreen();
      send({ type: "class.say", text });
    },
    [flushScreen, send],
  );

  const speechInput = useSpeechInput({
    onInterim: setDraft,
    onFinal: (text) => {
      if (text) void say(text);
      setDraft("");
    },
    onError: (message) => addToast({ kind: "info", title: message }),
  });
  const { start: startListening, stop: stopListening, listening } = speechInput;
  const stopVoices = voices.stop;

  // With ElevenLabs on the server, the class simply hears the lecturer's microphone.
  const liveHearing = meeting.liveTranscription && isLecturer && meeting.phase === "live";
  const [heard, setHeard] = useState("");
  useLiveTranscription({
    stream: media.micStream,
    enabled: liveHearing,
    getToken: meeting.getTranscriptionToken,
    gate: voices.playing,
    onPartial: setHeard,
    onCommit: (text) => void say(text),
    onBargeIn: stopVoices,
    onError: (message) => addToast({ kind: "info", title: message }),
  });

  // Starting a class is what asks for the mic, so students can hear from the first word.
  const { micOn, toggleMic: turnOnMic } = media;
  const micStarted = useRef(false);
  useEffect(() => {
    if (!liveHearing || micStarted.current) return;
    micStarted.current = true;
    if (!micOn) turnOnMic();
  }, [liveHearing, micOn, turnOnMic]);

  // Talking over a student silences them straight away, as it would in a room.
  const startTalking = useCallback(() => {
    stopVoices();
    startListening();
  }, [stopVoices, startListening]);

  // Hold Space to talk, unless the person is typing or on another control.
  useEffect(() => {
    if (!isLecturer || !speechInput.supported || meeting.liveTranscription) return;
    const busy = (target: EventTarget | null) =>
      target instanceof HTMLElement && target.closest("input, textarea, select, button, a") !== null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || busy(event.target)) return;
      event.preventDefault();
      startTalking();
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") stopListening();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isLecturer, speechInput.supported, meeting.liveTranscription, startTalking, stopListening]);

  const incoming = meeting.messages.filter((m) => m.senderId !== localUser.id).length;
  const unread = panel === "chat" ? 0 : incoming - seenMessages;

  const setPanel = useCallback(
    (next: PanelId | null) => {
      setPanelState(next);
      setSeenMessages(incoming);
    },
    [incoming],
  );

  const muted = !media.micOn && !listening;
  const cameraOn = media.camOn;
  const status = media.micLevel > 0 || listening ? "speaking" : "idle";

  const local = useMemo<Participant>(
    () => ({
      ...localUser,
      kind: "human",
      muted,
      cameraOn,
      handRaisedAt,
      status,
    }),
    [localUser, muted, cameraOn, handRaisedAt, status],
  );

  useEffect(() => {
    send({ type: "local.update", patch: { muted, cameraOn, handRaisedAt, status } });
  }, [send, muted, cameraOn, handRaisedAt, status]);

  const { toggleMic, toggleCam } = media;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        toggleMic();
      } else if (key === "e") {
        event.preventDefault();
        toggleCam();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMic, toggleCam]);

  const participants = useMemo(() => [local, ...meeting.remote], [local, meeting.remote]);
  // Moods come from the hidden scores, so only the lecturer sees them, and not in realistic mode.
  const { scores, scoreChanges } = meeting;
  const moods = useMemo(() => {
    const out: Record<string, Mood> = {};
    if (!isLecturer || !showInsights) return out;
    for (const person of meeting.remote) {
      if (person.kind !== "agent") continue;
      const mood = moodFor(person.id, scores[person.id], scoreChanges[person.id]);
      if (mood) out[person.id] = mood;
    }
    return out;
  }, [isLecturer, showInsights, meeting.remote, scores, scoreChanges]);
  // A pinned student can leave. Treat the pin as gone rather than showing nothing.
  const activePin = participants.some((p) => p.id === pinnedId) ? pinnedId : null;

  const captionSpeaker = meeting.caption
    ? participants.find((p) => p.id === meeting.caption?.speakerId)
    : undefined;
  const toasts = meeting.toasts.filter((toast) => {
    if (toast.kind === "chat") return panel !== "chat";
    if (toast.kind === "coach") return showInsights;
    return true;
  });

  function teach(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    voices.stop();
    void say(text);
    setDraft("");
  }

  function endClass() {
    voices.stop();
    if (isLecturer) {
      media.stopAll();
      send({ type: "class.end" });
    } else {
      onLeave();
    }
  }

  if (meeting.phase === "ended") {
    if (isLecturer && meeting.debrief) return <DebriefScreen debrief={meeting.debrief} />;
    return (
      <main className={styles.ending}>
        {isLecturer ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <h1>Preparing your debrief…</h1>
            {meeting.connection !== "connected" && <p>Connection lost. Reconnecting…</p>}
          </>
        ) : (
          <>
            <h1>The lecturer has ended this class</h1>
            <Link href="/">Return to home screen</Link>
          </>
        )}
      </main>
    );
  }

  return (
    <div className={styles.room}>
      <header className={styles.topBar}>
        <div className={styles.meetingInfo}>
          <span className={styles.clock}>{clock}</span>
          <span className={styles.divider} />
          <span className={styles.code}>{meeting.config.topic}</span>
          <button
            type="button"
            className={styles.infoButton}
            aria-label="Class details"
            title="Class details"
            onClick={() => setPanel(panel === "details" ? null : "details")}
          >
            <MdInfoOutline />
          </button>
        </div>
        <button
          type="button"
          className={styles.peopleButton}
          aria-label={`People, ${participants.length} in the class`}
          title="People"
          data-active={panel === "people"}
          onClick={() => setPanel(panel === "people" ? null : "people")}
        >
          <span className={styles.avatarStack}>
            {participants.slice(0, 3).map((person) => (
              <Avatar key={person.id} name={person.name} color={person.color} size={32} />
            ))}
          </span>
          <span className={styles.peopleCount}>{participants.length}</span>
        </button>
      </header>

      {meeting.connection !== "connected" && (
        <p className={styles.connectionBanner} role="status">
          {meeting.connection === "connecting"
            ? "Connecting to the class server…"
            : "Connection lost. Reconnecting…"}
        </p>
      )}

      <div className={styles.content}>
        <main className={styles.stage}>
          <Stage
            participants={participants}
            localId={localUser.id}
            camStream={media.camStream}
            screenStream={media.screenStream}
            layout={layout}
            pinnedId={activePin}
            lastSpeakerId={meeting.lastSpeakerId}
            studentLevel={voices.level}
            moods={moods}
            micLevel={media.micLevel}
            presentingNote={
              meeting.engine === "live"
                ? "You are presenting. The class can see this."
                : "You are presenting. Scripted students can't see this."
            }
            onStopPresenting={media.stopScreenShare}
            onShowPeople={() => setPanel("people")}
            onTogglePin={(id) => setPinnedId(activePin === id ? null : id)}
            onSetMuted={(id, value) => send({ type: "agent.setMuted", id, muted: value })}
            onRemove={(id) => send({ type: "agent.remove", id })}
            onCallOn={isLecturer ? (id) => send({ type: "agent.callOn", id }) : undefined}
          />

          <div className={styles.reactions} aria-hidden="true">
            {meeting.reactions.map((reaction) => (
              <div
                key={reaction.id}
                className={styles.reaction}
                style={{ "--drift": `${reaction.drift}px` } as CSSProperties}
              >
                <span className={styles.reactionEmoji}>{reaction.emoji}</span>
                <span className={styles.reactionName}>{reaction.senderName}</span>
              </div>
            ))}
          </div>

          <div className={styles.overlays}>
            <div className={styles.toasts} aria-live="polite">
              {media.error && (
                <div className={styles.toast} role="alert">
                  <MdErrorOutline className={styles.toastError} aria-hidden="true" />
                  <span className={styles.toastText}>{media.error}</span>
                  <button
                    type="button"
                    className={styles.toastClose}
                    aria-label="Dismiss"
                    onClick={media.clearError}
                  >
                    <MdClose />
                  </button>
                </div>
              )}
              {toasts.map((toast) => {
                const body = (
                  <>
                    {toast.kind === "coach" && (
                      <MdLightbulbOutline className={styles.toastCoach} aria-hidden="true" />
                    )}
                    {toast.color && <Avatar name={toast.title} color={toast.color} size={28} />}
                    <span className={styles.toastText}>
                      <strong>{toast.title}</strong>
                      {toast.body && <span className={styles.toastBody}>{toast.body}</span>}
                    </span>
                  </>
                );
                return toast.kind === "chat" ? (
                  <button
                    key={toast.id}
                    type="button"
                    className={styles.toast}
                    onClick={() => setPanel("chat")}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={toast.id} className={styles.toast}>
                    {body}
                  </div>
                );
              })}
            </div>

            {captionsOn && heard ? (
              <div className={styles.captions}>
                <Avatar name={localUser.name} color={localUser.color} size={32} />
                <div>
                  <strong>You</strong>
                  <p>{heard}</p>
                </div>
              </div>
            ) : (
              captionsOn &&
              meeting.caption &&
              captionSpeaker && (
                <div className={styles.captions}>
                  <Avatar name={captionSpeaker.name} color={captionSpeaker.color} size={32} />
                  <div>
                    <strong>
                      {captionSpeaker.id === localUser.id ? "You" : captionSpeaker.name}
                    </strong>
                    <p>{meeting.caption.text}</p>
                  </div>
                </div>
              )
            )}
          </div>
        </main>

        {panel && (
          <SidePanel
            panel={panel}
            onClose={() => setPanel(null)}
            onOpen={setPanel}
            code={code}
            topic={meeting.config.topic}
            localId={localUser.id}
            hostId={meeting.hostId}
            engine={meeting.engine}
            participants={participants}
            messages={meeting.messages}
            catalog={meeting.catalog}
            scores={meeting.scores}
            tips={meeting.tips}
            showInsights={showInsights}
            onShowInsights={setShowInsights}
            send={send}
            onCopied={() => addToast({ kind: "info", title: "Joining info copied" })}
          />
        )}
      </div>

      {isLecturer && (
        <form className={styles.teachBar} onSubmit={teach}>
          {speechInput.supported && !meeting.liveTranscription && (
            <button
              type="button"
              className={styles.talkButton}
              data-listening={listening}
              aria-label="Hold to talk"
              aria-pressed={listening}
              title="Hold to talk, or hold Space"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                startTalking();
              }}
              onPointerUp={stopListening}
              onPointerCancel={stopListening}
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                  event.preventDefault();
                  startTalking();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") stopListening();
              }}
            >
              <MdMic />
            </button>
          )}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              meeting.liveTranscription
                ? media.micOn
                  ? "The class can hear you. Just talk, or type here"
                  : "Turn on your mic so the class can hear you, or type here"
                : listening
                ? "Listening…"
                : speechInput.supported
                  ? "Hold Space or the mic to talk, or type here"
                  : "Type what you'd say to the class"
            }
            aria-label="Say something to the class"
            maxLength={2000}
            readOnly={listening}
          />
          <button
            type="button"
            aria-label={voicesOn ? "Turn off student voices" : "Turn on student voices"}
            aria-pressed={voicesOn}
            title={voicesOn ? "Turn off student voices" : "Turn on student voices"}
            onClick={() => setVoicesOn(!voicesOn)}
          >
            {voicesOn ? <MdVolumeUp /> : <MdVolumeOff />}
          </button>
          <button type="submit" disabled={!draft.trim() || listening} aria-label="Say it" title="Say it">
            <MdSend />
          </button>
        </form>
      )}

      <ControlBar
        media={media}
        handRaised={handRaisedAt !== null}
        onToggleHand={() => setHandRaisedAt(handRaisedAt === null ? Date.now() : null)}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn(!captionsOn)}
        onReact={(emoji) => send({ type: "reaction.send", emoji })}
        onLeave={endClass}
        leaveLabel={isLecturer ? "End class" : "Leave class"}
        panel={panel}
        onPanel={setPanel}
        unread={unread}
        layout={activePin ? "spotlight" : layout}
        onLayout={(next) => {
          setLayout(next);
          if (next !== "spotlight") setPinnedId(null);
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}
