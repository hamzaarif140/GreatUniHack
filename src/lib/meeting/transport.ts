import type { ClassConfig, ClientCommand, LocalUser, TransportEvent } from "./types";
import { WebSocketTransport } from "./webSocketTransport";

export interface ConnectOptions {
  meetingCode: string;
  localUser: LocalUser;
  config: ClassConfig;
}

export interface MeetingTransport {
  connect(options: ConnectOptions): void;
  disconnect(): void;
  send(command: ClientCommand): void;
  /** Returns a function that removes the handler. */
  onEvent(handler: (event: TransportEvent) => void): () => void;
}

const SERVER_URL = process.env.NEXT_PUBLIC_MEETING_WS_URL || "ws://localhost:4000";

export function createTransport(): MeetingTransport {
  return new WebSocketTransport(SERVER_URL);
}

/** The server's HTTP address, for streaming audio. */
export function serverHttpUrl(path: string) {
  return `${SERVER_URL.replace(/^ws/, "http")}${path}`;
}
