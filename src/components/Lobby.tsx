"use client";

import { useState, type FormEvent } from "react";
import { MdErrorOutline, MdMic, MdMicOff, MdVideocam, MdVideocamOff } from "react-icons/md";
import type { LocalMedia } from "@/lib/media/useLocalMedia";
import { DIFFICULTIES, TOPICS } from "@/lib/meeting/students";
import type { ClassConfig, Difficulty } from "@/lib/meeting/types";
import { Brand } from "./Brand";
import { VideoStream } from "./VideoStream";
import styles from "./Lobby.module.css";

interface LobbyProps {
  code: string;
  name: string;
  onNameChange: (name: string) => void;
  config: ClassConfig;
  onConfigChange: (config: ClassConfig) => void;
  media: LocalMedia;
  onJoin: () => void;
}

const CUSTOM = "__custom";

export function Lobby({ code, name, onNameChange, config, onConfigChange, media, onJoin }: LobbyProps) {
  const [custom, setCustom] = useState(false);
  const canJoin = name.trim().length > 0 && config.topic.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canJoin) onJoin();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
      </header>

      <main className={styles.main}>
        <section className={styles.previewColumn}>
          <div className={styles.preview}>
            {media.camStream ? (
              <VideoStream stream={media.camStream} mirrored label="Your camera preview" />
            ) : (
              <p className={styles.cameraOff}>Camera is off</p>
            )}
            {name.trim() && <span className={styles.name}>{name.trim()}</span>}
            <div className={styles.previewControls}>
              <button
                type="button"
                className={styles.round}
                data-off={!media.micOn}
                aria-pressed={media.micOn}
                aria-label={media.micOn ? "Turn off microphone" : "Turn on microphone"}
                title={media.micOn ? "Turn off microphone" : "Turn on microphone"}
                onClick={media.toggleMic}
              >
                {media.micOn ? <MdMic size={24} /> : <MdMicOff size={24} />}
              </button>
              <button
                type="button"
                className={styles.round}
                data-off={!media.camOn}
                aria-pressed={media.camOn}
                aria-label={media.camOn ? "Turn off camera" : "Turn on camera"}
                title={media.camOn ? "Turn off camera" : "Turn on camera"}
                onClick={media.toggleCam}
              >
                {media.camOn ? <MdVideocam size={24} /> : <MdVideocamOff size={24} />}
              </button>
            </div>
          </div>
          {media.error && (
            <p className={styles.error} role="alert">
              <MdErrorOutline size={18} aria-hidden="true" />
              {media.error}
            </p>
          )}
        </section>

        <form className={styles.joinColumn} onSubmit={submit}>
          <h1>Ready to teach?</h1>
          <p>Your students will arrive once you&apos;re in.</p>

          <label className={styles.nameField}>
            <span>Your name</span>
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={60}
              autoFocus
              autoComplete="name"
            />
          </label>

          <label className={styles.nameField}>
            <span>Topic</span>
            <select
              value={custom ? CUSTOM : config.topic}
              onChange={(event) => {
                const isCustom = event.target.value === CUSTOM;
                setCustom(isCustom);
                onConfigChange({ ...config, topic: isCustom ? "" : event.target.value });
              }}
            >
              {TOPICS.map((topic) => (
                <option key={topic.name} value={topic.name}>
                  {topic.name}
                </option>
              ))}
              <option value={CUSTOM}>Another topic…</option>
            </select>
          </label>

          {custom && (
            <label className={styles.nameField}>
              <span>What are you teaching?</span>
              <input
                value={config.topic}
                onChange={(event) => onConfigChange({ ...config, topic: event.target.value })}
                maxLength={80}
                placeholder="For example, binary search"
              />
            </label>
          )}

          <fieldset className={styles.difficulty}>
            <legend>Class mood</legend>
            {DIFFICULTIES.map((difficulty) => (
              <label key={difficulty.id} title={difficulty.hint}>
                <input
                  type="radio"
                  name="difficulty"
                  value={difficulty.id}
                  checked={config.difficulty === difficulty.id}
                  onChange={() => onConfigChange({ ...config, difficulty: difficulty.id as Difficulty })}
                />
                <span>{difficulty.label}</span>
              </label>
            ))}
          </fieldset>

          <button type="submit" className={styles.joinButton} disabled={!canJoin}>
            Start class
          </button>
          <p className={styles.code}>{code}</p>
          <p className={styles.notice}>
            For practice only. The students are fictional AI characters. Starting a class turns
            on your mic, and your speech is sent to a speech recognition service so the class can
            respond. Anything you present is sent to the AI so students can see it. This app
            doesn&apos;t store your voice or your screen.
          </p>
        </form>
      </main>
    </div>
  );
}
