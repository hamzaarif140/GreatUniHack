"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  MdClose,
  MdContentCopy,
  MdGroups,
  MdMic,
  MdMicOff,
  MdOutlinePanTool,
  MdPersonRemove,
  MdSearch,
  MdSend,
} from "react-icons/md";
import type {
  AgentEngine,
  AgentProfile,
  ChatMessage,
  ClientCommand,
  CoachTip,
  Participant,
} from "@/lib/meeting/types";
import { Avatar } from "./Avatar";
import type { PanelId } from "./ControlBar";
import styles from "./SidePanel.module.css";

const TITLES: Record<PanelId, string> = {
  people: "People",
  chat: "In-call messages",
  agents: "Students",
  host: "Coaching",
  details: "Class details",
};

const STATUS_TEXT: Partial<Record<Participant["status"], string>> = {
  thinking: "Thinking…",
  speaking: "Speaking",
};

interface SidePanelProps {
  panel: PanelId;
  onClose: () => void;
  onOpen: (panel: PanelId) => void;
  code: string;
  topic: string;
  localId: string;
  hostId: string | null;
  engine: AgentEngine;
  participants: Participant[];
  messages: ChatMessage[];
  catalog: AgentProfile[];
  scores: Record<string, number>;
  tips: CoachTip[];
  showInsights: boolean;
  onShowInsights: (show: boolean) => void;
  send: (command: ClientCommand) => void;
  onCopied: () => void;
}

export function SidePanel(props: SidePanelProps) {
  const { panel, onClose } = props;
  return (
    <aside className={styles.panel} aria-label={TITLES[panel]}>
      <header className={styles.header}>
        <h2>{TITLES[panel]}</h2>
        <button type="button" className={styles.close} aria-label="Close panel" title="Close" onClick={onClose}>
          <MdClose />
        </button>
      </header>
      {panel === "people" && <PeoplePanel {...props} />}
      {panel === "chat" && <ChatPanel {...props} />}
      {panel === "agents" && <StudentsPanel {...props} />}
      {panel === "host" && <CoachingPanel {...props} />}
      {panel === "details" && <DetailsPanel {...props} />}
    </aside>
  );
}

function PeoplePanel({ participants, localId, hostId, send, onOpen }: SidePanelProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = participants.filter((p) =>
    `${p.name} ${p.role ?? ""}`.toLowerCase().includes(needle),
  );
  const people = matches.filter((p) => p.kind === "human");
  const students = matches.filter((p) => p.kind === "agent");

  return (
    <div className={styles.body}>
      <button type="button" className={styles.outlineButton} onClick={() => onOpen("agents")}>
        <MdGroups aria-hidden="true" />
        Manage students
      </button>

      <label className={styles.search}>
        <MdSearch aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for people"
          aria-label="Search for people"
        />
      </label>

      {matches.length === 0 && <p className={styles.note}>No one matches that search.</p>}

      {people.length > 0 && (
        <PeopleGroup title="People" count={people.length}>
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              isLocal={person.id === localId}
              isHost={person.id === hostId}
              send={send}
            />
          ))}
        </PeopleGroup>
      )}
      {students.length > 0 && (
        <PeopleGroup title="Students" count={students.length}>
          {students.map((person) => (
            <PersonRow key={person.id} person={person} isLocal={false} isHost={false} send={send} />
          ))}
        </PeopleGroup>
      )}
    </div>
  );
}

function PeopleGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3>
        {title} <span>{count}</span>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function PersonRow({
  person,
  isLocal,
  isHost,
  send,
}: {
  person: Participant;
  isLocal: boolean;
  isHost: boolean;
  send: SidePanelProps["send"];
}) {
  const isStudent = person.kind === "agent";
  const secondary = isHost ? "Lecturer" : (STATUS_TEXT[person.status] ?? person.role);

  return (
    <li className={styles.person}>
      <Avatar name={person.name} color={person.color} size={36} />
      <div className={styles.personText}>
        <span className={styles.personName}>
          {person.name}
          {isLocal && " (You)"}
        </span>
        {secondary && <span className={styles.personMeta}>{secondary}</span>}
      </div>
      {person.handRaisedAt !== null && (
        <MdOutlinePanTool className={styles.handIcon} aria-label="Hand raised" />
      )}
      {isStudent ? (
        <>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={person.muted ? `Unmute ${person.name}` : `Mute ${person.name}`}
            title={person.muted ? "Unmute" : "Mute"}
            onClick={() => send({ type: "agent.setMuted", id: person.id, muted: !person.muted })}
          >
            {person.muted ? <MdMicOff /> : <MdMic />}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Remove ${person.name} from the class`}
            title="Remove from the class"
            onClick={() => send({ type: "agent.remove", id: person.id })}
          >
            <MdPersonRemove />
          </button>
        </>
      ) : (
        <span className={styles.micState} title={person.muted ? "Muted" : "Unmuted"}>
          {person.muted ? <MdMicOff aria-label="Muted" /> : <MdMic aria-label="Unmuted" />}
        </span>
      )}
    </li>
  );
}

function ChatPanel({ messages, localId, send }: SidePanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    send({ type: "chat.send", text });
    setDraft("");
  }

  return (
    <>
      <div className={styles.messages} ref={listRef}>
        <p className={styles.chatNotice}>
          Students read this chat and may reply here. Use a student&apos;s name to ask them directly.
        </p>
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const grouped =
            previous?.senderId === message.senderId && message.sentAt - previous.sentAt < 60000;
          return (
            <div key={message.id} className={styles.message} data-grouped={grouped}>
              {!grouped && (
                <div className={styles.messageMeta}>
                  <strong>{message.senderId === localId ? "You" : message.senderName}</strong>
                  <time>
                    {new Date(message.sentAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              )}
              <p>{message.text}</p>
            </div>
          );
        })}
      </div>
      <form className={styles.composer} onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send a message"
          aria-label="Send a message"
          maxLength={2000}
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send message" title="Send message">
          <MdSend />
        </button>
      </form>
    </>
  );
}

function StudentsPanel({
  catalog,
  participants,
  send,
  engine,
  localId,
  hostId,
  scores,
  showInsights,
}: SidePanelProps) {
  const inClass = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);
  const isLecturer = localId === hostId;
  return (
    <div className={styles.body}>
      <p className={styles.note}>
        {engine === "live"
          ? "These fictional students are played by Claude, and can make mistakes."
          : "These fictional students use scripted lines. Add an API key on the server to bring them to life."}
        {isLecturer && showInsights && " Only you can see the understanding bars."}
      </p>
      <ul className={styles.agentList}>
        {catalog.map((student) => {
          const present = inClass.has(student.id);
          const score = scores[student.id];
          return (
            <li key={student.id} className={styles.agent}>
              <Avatar name={student.name} color={student.color} size={40} />
              <div className={styles.personText}>
                <span className={styles.personName}>{student.name}</span>
                <span className={styles.personMeta}>{student.role}</span>
                <span className={styles.agentDescription}>{student.description}</span>
                {present && isLecturer && showInsights && score !== undefined && (
                  <div
                    className={styles.meter}
                    role="meter"
                    aria-label={`${student.name}'s understanding`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={score}
                    title={`Understanding: ${score} out of 100`}
                  >
                    <span className={styles.meterTrack}>
                      <span className={styles.meterFill} style={{ width: `${score}%` }} />
                    </span>
                    <span className={styles.meterValue}>{score}</span>
                  </div>
                )}
              </div>
              {isLecturer && (
                <button
                  type="button"
                  className={present ? styles.removeButton : styles.addButton}
                  aria-label={present ? `Remove ${student.name}` : `Add ${student.name}`}
                  onClick={() =>
                    send(
                      present
                        ? { type: "agent.remove", id: student.id }
                        : { type: "agent.invite", agentId: student.id },
                    )
                  }
                >
                  {present ? "Remove" : "Add"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CoachingPanel({
  participants,
  send,
  localId,
  hostId,
  tips,
  showInsights,
  onShowInsights,
}: SidePanelProps) {
  const anyUnmuted = participants.some((p) => p.kind === "agent" && !p.muted);
  if (localId !== hostId) {
    return (
      <div className={styles.body}>
        <p className={styles.note}>Coaching is only shown to the lecturer.</p>
      </div>
    );
  }
  return (
    <div className={styles.body}>
      <div className={styles.toggleRow}>
        <div className={styles.toggleText}>
          <span>Show understanding and tips</span>
          <small>Turn this off for realistic mode, where you read the room yourself.</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showInsights}
          aria-label="Show understanding and tips"
          className={styles.switch}
          onClick={() => onShowInsights(!showInsights)}
        >
          <i />
        </button>
      </div>

      <button
        type="button"
        className={styles.outlineButton}
        disabled={!anyUnmuted}
        onClick={() => send({ type: "agents.muteAll" })}
      >
        <MdMicOff aria-hidden="true" />
        Quiet the class
      </button>

      {showInsights && (
        <section>
          <h3 className={styles.detailsHeading}>Tips so far</h3>
          {tips.length === 0 ? (
            <p className={styles.note}>Tips will appear here as you teach.</p>
          ) : (
            <ul className={styles.tips}>
              {[...tips].reverse().map((tip) => (
                <li key={tip.id}>{tip.message}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function DetailsPanel({ code, topic, onCopied }: SidePanelProps) {
  const link = window.location.href;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      onCopied();
    } catch {
      // Clipboard can be blocked. The link stays visible for copying by hand.
    }
  }

  return (
    <div className={styles.body}>
      <h3 className={styles.detailsHeading}>Topic</h3>
      <p className={styles.detailsLink}>{topic}</p>
      <h3 className={styles.detailsHeading}>Joining info</h3>
      <p className={styles.detailsLink}>{link}</p>
      <button type="button" className={styles.textButton} onClick={copy}>
        <MdContentCopy aria-hidden="true" />
        Copy joining info
      </button>
      <h3 className={styles.detailsHeading}>Class code</h3>
      <p className={styles.detailsLink}>{code}</p>
    </div>
  );
}
