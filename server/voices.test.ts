import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import { WebSocket } from "ws";
import type { ServerEvent } from "../src/lib/meeting/types";
import { createMeetingServer } from "./app";
import { ScriptedBrain } from "./scriptedBrain";
import { DEFAULT_VOICES, ElevenLabsVoices } from "./voices";

/* A local stand-in for ElevenLabs. This checks our requests, not the real service. */

const ACCOUNT_VOICES = [
  { voice_id: "f1", labels: { gender: "female" } },
  { voice_id: "m1", labels: { gender: "male" } },
  { voice_id: "f2", labels: { gender: "female" } },
  { voice_id: "m2", labels: { gender: "male" } },
  { voice_id: "f3", labels: { gender: "female" } },
];

interface Captured {
  url: string;
  key: unknown;
  body: { text?: string; model_id?: string };
}

let closers: (() => unknown)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
  closers = [];
});

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return (server.address() as AddressInfo).port;
}

async function fakeElevenLabs(status = 200, canList = true) {
  const speech: Captured[] = [];
  const tokenKeys: unknown[] = [];
  let listCalls = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.url === "/v1/voices") {
        listCalls++;
        response.writeHead(canList ? 200 : 401, { "content-type": "application/json" });
        response.end(JSON.stringify(canList ? { voices: ACCOUNT_VOICES } : { detail: "missing voices_read" }));
        return;
      }
      if (request.url === "/v1/single-use-token/realtime_scribe") {
        tokenKeys.push(request.headers["xi-api-key"]);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ token: "sutkn_test" }));
        return;
      }
      speech.push({ url: request.url ?? "", key: request.headers["xi-api-key"], body: JSON.parse(body) });
      response.writeHead(status, { "content-type": "audio/mpeg" });
      response.end("fake-mp3");
    });
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, speech, tokenKeys, listCalls: () => listCalls };
}

async function appWith(voices: ElevenLabsVoices) {
  const app = createMeetingServer({
    brain: new ScriptedBrain(),
    allowedOrigins: ["http://localhost:3000"],
    voices,
    autoJoinIds: ["marcus"],
    timing: { firstStudentMs: 1, studentGapMs: 1, wordMs: 1, emptyGraceMs: 20 },
  });
  closers.push(() => app.close());
  return app.listen(0, "127.0.0.1");
}

test("a prepared line streams with the right voice, model and key, and the key isn't exposed", async () => {
  const api = await fakeElevenLabs();
  const voices = new ElevenLabsVoices({ apiKey: "secret-key", baseUrl: api.baseUrl });
  const port = await appWith(voices);

  const path = voices.prepare("priya", "Um, I think so.");
  assert.ok(!path.includes("secret-key"));
  const reply = await fetch(`http://127.0.0.1:${port}${path}`);

  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("content-type"), "audio/mpeg");
  assert.equal(await reply.text(), "fake-mp3");
  assert.equal(api.speech[0].key, "secret-key");
  assert.equal(api.speech[0].body.text, "Um, I think so.");
  assert.equal(api.speech[0].body.model_id, "eleven_flash_v2_5");
  assert.match(api.speech[0].url, /^\/v1\/text-to-speech\/f1\/stream\?/);
});

test("students get different voices that suit them, and the list is fetched only once", async () => {
  const api = await fakeElevenLabs();
  const voices = new ElevenLabsVoices({
    apiKey: "k",
    baseUrl: api.baseUrl,
    overrides: { samira: "chosen-voice" },
  });
  const port = await appWith(voices);

  const chosen: Record<string, string> = {};
  for (const id of ["marcus", "priya", "leo", "ana", "samira"]) {
    await (await fetch(`http://127.0.0.1:${port}${voices.prepare(id, "Hello")}`)).text();
    chosen[id] = api.speech.at(-1)?.url.match(/speech\/([^/]+)/)?.[1] ?? "";
  }

  assert.equal(chosen.samira, "chosen-voice");
  assert.equal(new Set(Object.values(chosen)).size, 5);
  assert.match(chosen.marcus, /^m/);
  assert.match(chosen.priya, /^f/);
  assert.equal(api.listCalls(), 1);
});

test("a key that can't list voices still works, using the default voices", async () => {
  const api = await fakeElevenLabs(200, false);
  const voices = new ElevenLabsVoices({ apiKey: "k", baseUrl: api.baseUrl, overrides: { ana: "my-ana" } });
  const port = await appWith(voices);

  await (await fetch(`http://127.0.0.1:${port}${voices.prepare("priya", "Hi")}`)).text();
  await (await fetch(`http://127.0.0.1:${port}${voices.prepare("ana", "Hi")}`)).text();
  assert.match(api.speech[0].url, new RegExp(DEFAULT_VOICES.priya));
  assert.match(api.speech[1].url, /my-ana/);
});

test("only the lecturer gets a transcription token, and the real key stays on the server", async () => {
  const api = await fakeElevenLabs();
  const voices = new ElevenLabsVoices({ apiKey: "secret-key", baseUrl: api.baseUrl });
  const port = await appWith(voices);

  const join = async (id: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://localhost:3000" });
    closers.push(() => socket.terminate());
    const events: ServerEvent[] = [];
    socket.on("message", (data) => events.push(JSON.parse(data.toString())));
    await new Promise((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "hello", meetingCode: "token-test", user: { id, name: id, color: "#ec407a" } }));
    for (let i = 0; i < 200 && !events.some((e) => e.type === "snapshot"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { socket, events };
  };
  const lecturer = await join("lecturer");
  const observer = await join("observer");

  const snapshot = lecturer.events.find((event) => event.type === "snapshot");
  assert.ok(snapshot?.type === "snapshot" && snapshot.liveTranscription);

  observer.socket.send(JSON.stringify({ type: "stt.token" }));
  lecturer.socket.send(JSON.stringify({ type: "stt.token" }));
  for (let i = 0; i < 200 && !lecturer.events.some((e) => e.type === "stt.token"); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }

  const issued = lecturer.events.find((event) => event.type === "stt.token");
  assert.ok(issued?.type === "stt.token");
  assert.equal(issued.token, "sutkn_test");
  assert.deepEqual(api.tokenKeys, ["secret-key"]);
  assert.ok(!observer.events.some((event) => event.type === "stt.token"));
  assert.ok(!JSON.stringify(lecturer.events).includes("secret-key"));
});

test("unknown lines are refused, and a line can't be replayed without limit", async () => {
  const api = await fakeElevenLabs();
  const voices = new ElevenLabsVoices({ apiKey: "k", baseUrl: api.baseUrl });
  const port = await appWith(voices);

  assert.equal((await fetch(`http://127.0.0.1:${port}/speech/nope`)).status, 404);

  const url = `http://127.0.0.1:${port}${voices.prepare("ana", "Hello")}`;
  for (let i = 0; i < 3; i++) await (await fetch(url)).text();
  assert.equal((await fetch(url)).status, 404);
  assert.equal(api.speech.length, 3);
});

test("a failure upstream reaches the browser as an error it can fall back from", async () => {
  const api = await fakeElevenLabs(500);
  const voices = new ElevenLabsVoices({ apiKey: "k", baseUrl: api.baseUrl });
  const port = await appWith(voices);
  const reply = await fetch(`http://127.0.0.1:${port}${voices.prepare("ana", "Hello")}`);
  assert.equal(reply.status, 502);
});

test("in class, spoken lines carry an audio path that works", async () => {
  const api = await fakeElevenLabs();
  const voices = new ElevenLabsVoices({ apiKey: "k", baseUrl: api.baseUrl });
  const port = await appWith(voices);

  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://localhost:3000" });
  closers.push(() => socket.terminate());
  const events: ServerEvent[] = [];
  socket.on("message", (data) => events.push(JSON.parse(data.toString())));
  await new Promise((resolve) => socket.once("open", resolve));
  socket.send(
    JSON.stringify({ type: "hello", meetingCode: "voice-test", user: { id: "l", name: "L", color: "#ec407a" } }),
  );
  const until = async (match: (event: ServerEvent) => boolean) => {
    for (let i = 0; i < 400 && !events.some(match); i++) await new Promise((r) => setTimeout(r, 5));
    const found = events.find(match);
    assert.ok(found, `timed out; saw ${events.map((e) => e.type).join(", ")}`);
    return found;
  };
  await until((event) => event.type === "participant.joined");

  // Asked by name, the scripted Marcus answers straight away.
  socket.send(JSON.stringify({ type: "class.say", text: "Marcus, can you tell me what recursion is?" }));
  const speech = await until((event) => event.type === "speech");
  assert.ok(speech.type === "speech" && speech.cue.audioPath);

  const reply = await fetch(`http://127.0.0.1:${port}${speech.cue.audioPath}`, {
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("access-control-allow-origin"), "http://localhost:3000", "the page may measure it");
  await reply.text();
  assert.equal(api.speech[0].body.text, speech.cue.text);
});
