import type { ConnectOptions, MeetingTransport } from "./transport";
import type { ClientCommand, LocalPatch, TransportEvent } from "./types";

const MAX_BACKOFF_MS = 10_000;

/** Talks to the Node.js meeting server and reconnects if the connection drops. */
export class WebSocketTransport implements MeetingTransport {
  private handlers = new Set<(event: TransportEvent) => void>();
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private options: ConnectOptions | null = null;
  private attempts = 0;
  /** The latest local state, resent after every reconnect. */
  private localState: LocalPatch = {};

  constructor(private url: string) {}

  connect(options: ConnectOptions) {
    this.options = options;
    this.emit({ type: "connection", status: "connecting" });
    // Deferred so React Strict Mode's immediate disconnect never opens a socket.
    this.timer = setTimeout(() => this.open(), 0);
  }

  disconnect() {
    this.options = null;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }

  onEvent(handler: (event: TransportEvent) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(command: ClientCommand) {
    if (command.type === "local.update") {
      this.localState = { ...this.localState, ...command.patch };
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(command));
    } else if (!["local.update", "screen.frame", "screen.stop"].includes(command.type)) {
      this.emit({ type: "notice", message: "You're offline, so that didn't go through." });
    }
  }

  private emit(event: TransportEvent) {
    this.handlers.forEach((handler) => handler(event));
  }

  private open() {
    const options = this.options;
    if (!options) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      socket.send(
        JSON.stringify({
          type: "hello",
          meetingCode: options.meetingCode,
          user: options.localUser,
          config: options.config,
        }),
      );
      socket.send(JSON.stringify({ type: "local.update", patch: this.localState }));
      this.emit({ type: "connection", status: "connected" });
    };

    socket.onmessage = (message) => {
      if (this.socket === socket) this.emit(JSON.parse(String(message.data)));
    };

    socket.onclose = () => {
      if (this.socket !== socket || !this.options) return;
      this.emit({ type: "connection", status: "reconnecting" });
      const delay = Math.min(500 * 2 ** this.attempts++, MAX_BACKOFF_MS);
      this.timer = setTimeout(() => this.open(), delay);
    };
  }
}
