"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  MdApps,
  MdCallEnd,
  MdCheck,
  MdChatBubbleOutline,
  MdClosedCaption,
  MdClosedCaptionOff,
  MdFullscreen,
  MdFullscreenExit,
  MdEventSeat,
  MdGridView,
  MdKeyboardArrowUp,
  MdMic,
  MdMicOff,
  MdMoreVert,
  MdOutlineAdminPanelSettings,
  MdOutlineEmojiEmotions,
  MdOutlinePanTool,
  MdPresentToAll,
  MdVideocam,
  MdVideocamOff,
  MdViewSidebar,
} from "react-icons/md";
import type { LocalMedia } from "@/lib/media/useLocalMedia";
import type { Layout } from "./Stage";
import styles from "./ControlBar.module.css";

export type PanelId = "people" | "chat" | "agents" | "host" | "details";
type Popover = "mic" | "cam" | "reactions" | "more" | null;

const EMOJI = ["💖", "👍", "🎉", "👏", "😂", "😮", "😢", "🤔", "👎"];

interface ControlBarProps {
  media: LocalMedia;
  handRaised: boolean;
  onToggleHand: () => void;
  captionsOn: boolean;
  onToggleCaptions: () => void;
  onReact: (emoji: string) => void;
  onLeave: () => void;
  leaveLabel: string;
  panel: PanelId | null;
  onPanel: (panel: PanelId | null) => void;
  unread: number;
  layout: Layout;
  onLayout: (layout: Layout) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function ControlBar({
  media,
  handRaised,
  onToggleHand,
  captionsOn,
  onToggleCaptions,
  onReact,
  onLeave,
  leaveLabel,
  panel,
  onPanel,
  unread,
  layout,
  onLayout,
  isFullscreen,
  onToggleFullscreen,
}: ControlBarProps) {
  const [popover, setPopover] = useState<Popover>(null);

  useEffect(() => {
    if (!popover) return;
    function onPointerDown(event: PointerEvent) {
      const { target } = event;
      if (!(target instanceof Element) || !target.closest("[data-popover-root]")) setPopover(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPopover(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popover]);

  const toggle = (next: Exclude<Popover, null>) =>
    setPopover((current) => (current === next ? null : next));

  const togglePanel = (next: PanelId) => {
    onPanel(panel === next ? null : next);
    setPopover(null);
  };

  const presenting = media.screenStream !== null;
  const togglePresent = () => {
    if (presenting) media.stopScreenShare();
    else void media.startScreenShare();
    setPopover(null);
  };

  return (
    <footer className={styles.bar}>
      <div className={styles.center}>
        <MediaControl
          label="microphone"
          shortcut="Ctrl + D"
          on={media.micOn}
          iconOn={<MdMic />}
          iconOff={<MdMicOff />}
          level={media.micLevel}
          showLevel
          onToggle={media.toggleMic}
          menuOpen={popover === "mic"}
          onOpenMenu={() => {
            toggle("mic");
            void media.refreshDevices();
          }}
          devices={media.devices.mics}
          selectedId={media.micId}
          onSelect={(id) => {
            media.selectMic(id);
            setPopover(null);
          }}
        />
        <MediaControl
          label="camera"
          shortcut="Ctrl + E"
          on={media.camOn}
          iconOn={<MdVideocam />}
          iconOff={<MdVideocamOff />}
          onToggle={media.toggleCam}
          menuOpen={popover === "cam"}
          onOpenMenu={() => {
            toggle("cam");
            void media.refreshDevices();
          }}
          devices={media.devices.cams}
          selectedId={media.camId}
          onSelect={(id) => {
            media.selectCam(id);
            setPopover(null);
          }}
        />

        <RoundButton
          className={styles.wide}
          label={presenting ? "Stop presenting" : "Present now"}
          active={presenting}
          onClick={togglePresent}
        >
          <MdPresentToAll />
        </RoundButton>

        <div className={styles.anchor} data-popover-root>
          <RoundButton
            className={styles.wide}
            label="Send a reaction"
            active={popover === "reactions"}
            onClick={() => toggle("reactions")}
          >
            <MdOutlineEmojiEmotions />
          </RoundButton>
          {popover === "reactions" && (
            <div className={styles.reactionBar} role="group" aria-label="Reactions">
              {EMOJI.map((emoji) => (
                <button key={emoji} type="button" onClick={() => onReact(emoji)} aria-label={`React with ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <RoundButton
          className={styles.wide}
          label={captionsOn ? "Turn off captions" : "Turn on captions"}
          active={captionsOn}
          onClick={onToggleCaptions}
        >
          {captionsOn ? <MdClosedCaption /> : <MdClosedCaptionOff />}
        </RoundButton>

        <RoundButton
          label={handRaised ? "Lower hand" : "Raise hand"}
          active={handRaised}
          onClick={onToggleHand}
        >
          <MdOutlinePanTool />
        </RoundButton>

        <div className={styles.anchor} data-popover-root>
          <RoundButton
            label="More options"
            narrow
            expanded={popover === "more"}
            onClick={() => toggle("more")}
          >
            <MdMoreVert />
          </RoundButton>
          {popover === "more" && (
            <div className={`${styles.menu} ${styles.moreMenu}`} role="menu">
              <MenuItem
                icon={<MdEventSeat />}
                checked={layout === "classroom"}
                onClick={() => {
                  onLayout("classroom");
                  setPopover(null);
                }}
              >
                Classroom layout
              </MenuItem>
              <MenuItem
                icon={<MdGridView />}
                checked={layout === "tiled"}
                onClick={() => {
                  onLayout("tiled");
                  setPopover(null);
                }}
              >
                Tiled layout
              </MenuItem>
              <MenuItem
                icon={<MdViewSidebar />}
                checked={layout === "spotlight"}
                onClick={() => {
                  onLayout("spotlight");
                  setPopover(null);
                }}
              >
                Spotlight layout
              </MenuItem>
              <MenuItem
                icon={isFullscreen ? <MdFullscreenExit /> : <MdFullscreen />}
                onClick={() => {
                  onToggleFullscreen();
                  setPopover(null);
                }}
              >
                {isFullscreen ? "Exit full screen" : "Full screen"}
              </MenuItem>

              {/* On phones the bar has no room for these, so they live here. */}
              <div className={styles.narrowOnly}>
                <hr />
                <MenuItem icon={<MdOutlineEmojiEmotions />} onClick={() => setPopover("reactions")}>
                  Send a reaction
                </MenuItem>
                <MenuItem
                  icon={captionsOn ? <MdClosedCaption /> : <MdClosedCaptionOff />}
                  onClick={() => {
                    onToggleCaptions();
                    setPopover(null);
                  }}
                >
                  {captionsOn ? "Turn off captions" : "Turn on captions"}
                </MenuItem>
                <MenuItem icon={<MdPresentToAll />} onClick={togglePresent}>
                  {presenting ? "Stop presenting" : "Present now"}
                </MenuItem>
                <hr />
                <MenuItem icon={<MdChatBubbleOutline />} onClick={() => togglePanel("chat")}>
                  Chat{unread > 0 ? ` (${unread} new)` : ""}
                </MenuItem>
                <MenuItem icon={<MdApps />} onClick={() => togglePanel("agents")}>
                  Students
                </MenuItem>
                <MenuItem icon={<MdOutlineAdminPanelSettings />} onClick={() => togglePanel("host")}>
                  Coaching
                </MenuItem>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.hangUp}
          aria-label={leaveLabel}
          title={leaveLabel}
          onClick={onLeave}
        >
          <MdCallEnd />
        </button>
      </div>

      <div className={styles.right}>
        <PanelButton label="Chat with everyone" active={panel === "chat"} badge={unread} onClick={() => togglePanel("chat")}>
          <MdChatBubbleOutline />
        </PanelButton>
        <PanelButton label="Students" active={panel === "agents"} onClick={() => togglePanel("agents")}>
          <MdApps />
        </PanelButton>
        <PanelButton label="Coaching" active={panel === "host"} onClick={() => togglePanel("host")}>
          <MdOutlineAdminPanelSettings />
        </PanelButton>
      </div>
    </footer>
  );
}

interface RoundButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  narrow?: boolean;
  expanded?: boolean;
  className?: string;
  children: ReactNode;
}

function RoundButton({ label, onClick, active, narrow, expanded, className, children }: RoundButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.control} ${narrow ? styles.narrow : ""} ${className ?? ""}`}
      data-active={active}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface MediaControlProps {
  label: string;
  shortcut: string;
  on: boolean;
  iconOn: ReactNode;
  iconOff: ReactNode;
  level?: number;
  showLevel?: boolean;
  onToggle: () => void;
  menuOpen: boolean;
  onOpenMenu: () => void;
  devices: MediaDeviceInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function MediaControl({
  label,
  shortcut,
  on,
  iconOn,
  iconOff,
  level = 0,
  showLevel,
  onToggle,
  menuOpen,
  onOpenMenu,
  devices,
  selectedId,
  onSelect,
}: MediaControlProps) {
  const title = `Turn ${on ? "off" : "on"} ${label} (${shortcut})`;
  return (
    <div className={styles.anchor} data-popover-root>
      <div className={styles.mediaGroup} data-off={!on}>
        <button
          type="button"
          className={styles.deviceButton}
          aria-label={`Choose a ${label}`}
          aria-expanded={menuOpen}
          title={`Choose a ${label}`}
          onClick={onOpenMenu}
        >
          {showLevel && on ? (
            <span className={styles.level} aria-hidden="true">
              <i style={{ height: 4 + level * 2 }} />
              <i style={{ height: 4 + level * 4 }} />
              <i style={{ height: 4 + level * 2 }} />
            </span>
          ) : (
            <MdKeyboardArrowUp />
          )}
        </button>
        <button
          type="button"
          className={styles.mediaToggle}
          aria-label={`Turn ${on ? "off" : "on"} ${label}`}
          aria-pressed={on}
          title={title}
          onClick={onToggle}
        >
          {on ? iconOn : iconOff}
        </button>
      </div>

      {menuOpen && (
        <div className={styles.menu} role="menu">
          {devices.length === 0 ? (
            <p className={styles.menuNote}>No {label} found yet. Turn it on to allow access.</p>
          ) : (
            devices.map((device, index) => (
              <MenuItem
                key={device.deviceId || index}
                checked={device.deviceId === selectedId}
                onClick={() => onSelect(device.deviceId)}
              >
                {device.label || `${label[0].toUpperCase()}${label.slice(1)} ${index + 1}`}
              </MenuItem>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  checked,
  onClick,
  children,
}: {
  icon?: ReactNode;
  checked?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" className={styles.menuItem} onClick={onClick}>
      {icon && <span className={styles.menuIcon}>{icon}</span>}
      <span className={styles.menuLabel}>{children}</span>
      {checked && <MdCheck className={styles.menuCheck} aria-label="Selected" />}
    </button>
  );
}

function PanelButton({
  label,
  active,
  badge = 0,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.panelButton}
      data-active={active}
      aria-label={badge > 0 ? `${label}, ${badge} new` : label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
      {badge > 0 && <span className={styles.badge}>{badge > 9 ? "9+" : badge}</span>}
    </button>
  );
}
