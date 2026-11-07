import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerEvent } from "../src/lib/meeting/types";
import type { AgentBrain } from "./brain";
import { Room, type RoomLimits, type RoomTiming } from "./room";
import { parseCommand, parseHello } from "./validate";
import type { ElevenLabsVoices } from "./voices";

/** Large enough for one screen snapshot. Every field is limited again in validate.ts. */
const MAX_MESSAGE_BYTES = 1024 * 1024 + 1024;
const MAX_ROOMS = 50;
const MAX_HUMANS_PER_ROOM = 20;
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30_000;

export interface MeetingServerOptions {
  brain: AgentBrain;
  /** Browser origins allowed to connect. */
  allowedOrigins: string[];
  timing?: RoomTiming;
  limits?: RoomLimits;
  autoJoinIds?: string[];
  /** Hosted student voices. Without them, browsers use their built-in voices. */
  voices?: ElevenLabsVoices;
  /** Source of chance for chaotic classes, replaceable in tests. */
  random?: () => number;
}

export function createMeetingServer(options: MeetingServerOptions) {
  const rooms = new Map<string, Room>();

  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, engine: options.brain.engine, rooms: rooms.size }));
      return;
    }
    const speech = request.url?.match(/^\/speech\/([\w-]+)$/);
    if (speech && request.method === "GET" && options.voices) {
      // Lets the class page read the audio's loudness for its speaking visualiser.
      const origin = request.headers.origin;
      if (origin && options.allowedOrigins.includes(origin)) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "origin");
      }
      void options.voices.stream(speech[1], response);
      return;
    }
    response.writeHead(404).end();
  });

  const sockets = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    // Browsers always send Origin, so this stops other websites using a visitor's
    // browser to join meetings and spend the server's API credit.
    verifyClient: ({ origin }: { origin?: string; req: IncomingMessage }) =>
      origin !== undefined && options.allowedOrigins.includes(origin),
  });

  function getRoom(code: string) {
    const existing = rooms.get(code);
    if (existing) return existing;
    if (rooms.size >= MAX_ROOMS) return null;
    const room: Room = new Room({
      brain: options.brain,
      timing: options.timing,
      limits: options.limits,
      autoJoinIds: options.autoJoinIds,
      speech: options.voices,
      random: options.random,
      onEmpty: () => {
        room.destroy();
        rooms.delete(code);
      },
    });
    rooms.set(code, room);
    return room;
  }

  sockets.on("connection", (socket) => {
    let session: { room: Room; userId: string; send: (event: ServerEvent) => void } | null = null;
    const helloTimer = setTimeout(() => socket.close(4000, "hello expected"), HELLO_TIMEOUT_MS);
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (session) {
        const command = parseCommand(message);
        if (command) session.room.handle(session.userId, command);
        return;
      }

      const hello = parseHello(message);
      if (!hello) {
        socket.close(4001, "invalid hello");
        return;
      }
      clearTimeout(helloTimer);

      const room = getRoom(hello.meetingCode);
      if (!room || room.humanCount >= MAX_HUMANS_PER_ROOM) {
        socket.close(4002, "server full");
        return;
      }
      const send = (event: ServerEvent) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
      };
      session = { room, userId: hello.user.id, send };
      room.join(hello.user, send, hello.config);
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      session?.room.leave(session.userId, session.send);
    });
    socket.on("error", (error) => console.warn("[socket]", error.message));
  });

  return {
    /** Resolves with the port, which is useful when asked for port 0. */
    listen(port: number, host: string) {
      return new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => resolve((http.address() as AddressInfo).port));
      });
    },
    close() {
      rooms.forEach((room) => room.destroy());
      rooms.clear();
      sockets.clients.forEach((client) => client.terminate());
      sockets.close();
      return new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
