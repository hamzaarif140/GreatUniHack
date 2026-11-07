"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { DEFAULT_CONFIG } from "./students";
import { createTransport, type MeetingTransport } from "./transport";
import type {
  AgentEngine,
  AgentProfile,
  Caption,
  ChatMessage,
  ClassConfig,
  ClassPhase,
  ClientCommand,
  CoachTip,
  ConnectionStatus,
  Debrief,
  LocalUser,
  Participant,
  SpeechCue,
  TransportEvent,
} from "./types";

export interface Toast {
  id: number;
  kind: "info" | "chat" | "coach";
  title: string;
  body?: string;
  color?: string;
}

export interface FloatingReaction {
  id: number;
  emoji: string;
  senderName: string;
  /** Horizontal drift in px, so simultaneous reactions don't overlap. */
  drift: number;
}

interface MeetingState {
  connection: ConnectionStatus;
  hostId: string | null;
  engine: AgentEngine;
  liveTranscription: boolean;
  config: ClassConfig;
  phase: ClassPhase;
  scores: Record<string, number>;
  /** How much each score moved in the latest update, so moods can show a sudden change. */
  scoreChanges: Record<string, number>;
  tips: CoachTip[];
  debrief: Debrief | null;
  speech: SpeechCue | null;
  remote: Participant[];
  catalog: AgentProfile[];
  messages: ChatMessage[];
  caption: Caption | null;
  lastSpeakerId: string | null;
  toasts: Toast[];
  reactions: FloatingReaction[];
}

type Action =
  | { type: "reset" }
  | { type: "event"; event: TransportEvent }
  | { type: "caption.clear" }
  | { type: "toast.add"; toast: Toast }
  | { type: "toast.remove"; id: number }
  | { type: "reaction.add"; reaction: FloatingReaction }
  | { type: "reaction.remove"; id: number };

const initialState: MeetingState = {
  connection: "connecting",
  hostId: null,
  engine: "simulated",
  liveTranscription: false,
  config: DEFAULT_CONFIG,
  phase: "live",
  scores: {},
  scoreChanges: {},
  tips: [],
  debrief: null,
  speech: null,
  remote: [],
  catalog: [],
  messages: [],
  caption: null,
  lastSpeakerId: null,
  toasts: [],
  reactions: [],
};

function applyEvent(state: MeetingState, event: TransportEvent): MeetingState {
  switch (event.type) {
    case "connection":
      return { ...state, connection: event.status };
    case "snapshot":
      return {
        ...state,
        remote: event.participants,
        messages: event.messages,
        catalog: event.catalog,
        hostId: event.hostId,
        engine: event.engine,
        liveTranscription: event.liveTranscription,
        config: event.config,
        phase: event.phase,
        scores: event.scores,
        scoreChanges: {},
        tips: event.tips,
        debrief: event.debrief,
        caption: null,
        speech: null,
      };
    case "host":
      return { ...state, hostId: event.id };
    case "notice":
    case "reaction":
    case "stt.token":
      return state;
    case "class.scores": {
      const scoreChanges: Record<string, number> = {};
      for (const [id, score] of Object.entries(event.scores)) {
        scoreChanges[id] = id in state.scores ? score - state.scores[id] : 0;
      }
      return { ...state, scores: event.scores, scoreChanges };
    }
    case "class.coach":
      return { ...state, tips: [...state.tips, event.tip] };
    case "class.phase":
      return { ...state, phase: event.phase, caption: null, speech: null };
    case "speech":
      return { ...state, speech: event.cue };
    case "speech.stop":
      return { ...state, speech: null };
    case "class.debrief":
      return { ...state, debrief: event.debrief };
    case "participant.joined":
      // A join is an upsert, so a resent roster can't create duplicates.
      return {
        ...state,
        remote: state.remote.some((p) => p.id === event.participant.id)
          ? state.remote.map((p) => (p.id === event.participant.id ? event.participant : p))
          : [...state.remote, event.participant],
      };
    case "participant.left":
      return {
        ...state,
        remote: state.remote.filter((p) => p.id !== event.id),
        caption: state.caption?.speakerId === event.id ? null : state.caption,
        lastSpeakerId: state.lastSpeakerId === event.id ? null : state.lastSpeakerId,
      };
    case "participant.updated":
      return {
        ...state,
        remote: state.remote.map((p) => (p.id === event.id ? { ...p, ...event.patch } : p)),
        lastSpeakerId: event.patch.status === "speaking" ? event.id : state.lastSpeakerId,
      };
    case "caption":
      return {
        ...state,
        caption: event.text
          ? { speakerId: event.speakerId, text: event.text, final: event.final }
          : null,
      };
    case "chat.message":
      return { ...state, messages: [...state.messages, event.message] };
  }
}

function reducer(state: MeetingState, action: Action): MeetingState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "event":
      return applyEvent(state, action.event);
    case "caption.clear":
      return { ...state, caption: null };
    case "toast.add":
      return { ...state, toasts: [...state.toasts, action.toast].slice(-4) };
    case "toast.remove":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "reaction.add":
      return { ...state, reactions: [...state.reactions, action.reaction] };
    case "reaction.remove":
      return { ...state, reactions: state.reactions.filter((r) => r.id !== action.id) };
  }
}

const TOAST_MS = 4500;
const COACH_TOAST_MS = 9000;
const REACTION_MS = 3200;
const CAPTION_LINGER_MS = 2500;
const TOKEN_TIMEOUT_MS = 8000;

export function useMeeting(meetingCode: string, localUser: LocalUser, config: ClassConfig) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const transportRef = useRef<MeetingTransport | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);
  const namesRef = useRef(new Map<string, { name: string; color: string }>());
  const tokenWaiters = useRef<((token: string | null) => void)[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      dispatch({ type: "toast.add", toast: { ...toast, id } });
      later(toast.kind === "coach" ? COACH_TOAST_MS : TOAST_MS, () =>
        dispatch({ type: "toast.remove", id }),
      );
    },
    [later],
  );

  useEffect(() => {
    const transport = createTransport();
    transportRef.current = transport;
    const pendingTimers = timers.current;
    const names = namesRef.current;
    names.set(localUser.id, { name: "You", color: localUser.color });

    const off = transport.onEvent((event) => {
      dispatch({ type: "event", event });

      if (event.type === "stt.token") {
        tokenWaiters.current.splice(0).forEach((waiter) => waiter(event.token));
      } else if (event.type === "snapshot") {
        event.participants.forEach(({ id, name, color }) => names.set(id, { name, color }));
      } else if (event.type === "notice") {
        addToast({ kind: "info", title: event.message });
      } else if (event.type === "class.coach") {
        addToast({ kind: "coach", title: "Coach", body: event.tip.message });
      } else if (event.type === "participant.joined") {
        const { id, name, color } = event.participant;
        names.set(id, { name, color });
        addToast({ kind: "info", title: `${name} joined`, color });
      } else if (event.type === "participant.left") {
        const person = names.get(event.id);
        if (person) addToast({ kind: "info", title: `${person.name} left`, color: person.color });
      } else if (event.type === "chat.message" && event.message.senderId !== localUser.id) {
        addToast({
          kind: "chat",
          title: event.message.senderName,
          body: event.message.text,
          color: names.get(event.message.senderId)?.color,
        });
      } else if (event.type === "reaction") {
        const id = nextId.current++;
        const senderName = names.get(event.senderId)?.name ?? "Someone";
        const drift = Math.round((Math.random() - 0.5) * 80);
        dispatch({ type: "reaction.add", reaction: { id, emoji: event.emoji, senderName, drift } });
        later(REACTION_MS, () => dispatch({ type: "reaction.remove", id }));
      } else if (event.type === "caption") {
        if (captionTimer.current) clearTimeout(captionTimer.current);
        captionTimer.current = event.final
          ? setTimeout(() => dispatch({ type: "caption.clear" }), CAPTION_LINGER_MS)
          : null;
      }
    });

    transport.connect({ meetingCode, localUser, config });

    return () => {
      off();
      transport.disconnect();
      transportRef.current = null;
      pendingTimers.forEach(clearTimeout);
      pendingTimers.clear();
      if (captionTimer.current) clearTimeout(captionTimer.current);
      // The next connection reports its own roster, so nothing from this one may linger.
      dispatch({ type: "reset" });
    };
  }, [meetingCode, localUser, config, addToast, later]);

  const send = useCallback((command: ClientCommand) => {
    transportRef.current?.send(command);
  }, []);

  const getTranscriptionToken = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no token")), TOKEN_TIMEOUT_MS);
        tokenWaiters.current.push((token) => {
          clearTimeout(timer);
          if (token) resolve(token);
          else reject(new Error("no token"));
        });
        transportRef.current?.send({ type: "stt.token" });
      }),
    [],
  );

  return { ...state, send, addToast, getTranscriptionToken };
}
