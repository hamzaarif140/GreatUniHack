# Roundtable

A practice classroom for university lecturers and TAs. The lecturer joins a video-call style class and teaches a computer science topic to AI students, who hear them, can see their shared screen, answer out loud, and react to how well they explain things. A coaching debrief follows.

The point of the product is the **hidden understanding scores and the debrief**. They're what make it a training tool and not a chatbot, so protect them when making trade-offs. "Roundtable" is a placeholder name, set in `src/lib/brand.ts`.

@AGENTS.md

## Commands

Copy `.env.example` to `.env` first. Run the first two together, in separate terminals.

```bash
npm run server      # class server on ws://127.0.0.1:4000, restarts on changes
npm run dev         # web app on http://localhost:3000
npm test            # server tests; free, uses fakes, no network
npm run lint
npx tsc --noEmit    # also type-checks server/
npm run build
npm run check       # calls the real Claude and ElevenLabs APIs; costs a fraction of a cent
```

Before calling work done, run `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build`.

## Keys and secrets

- Secrets live only in `.env`, which is git-ignored. Everyone uses their own keys. Never commit a key, print one, or put one in a `NEXT_PUBLIC_` variable, since those reach the browser.
- `ANTHROPIC_API_KEY`: live students. Without it, students read scripted lines and are scored by simple rules, which is free and fine for UI work.
- `ELEVENLABS_API_KEY`: live transcription and student voices. Without it, the app falls back to the browser's speech recognition (push-to-talk) and voices.
- The browser never gets a real key. It receives single-use transcription tokens through the WebSocket, and student audio is streamed through the server at `/speech/<random id>`.

## How it works

```
Browser (Next.js/React) <-- WebSocket, JSON --> Node server (server/) --> Claude API
       |                                                |
       +-- mic audio --> ElevenLabs transcription       +--> ElevenLabs voices
```

For each thing the lecturer says or types, `Room.processInput` in `server/room.ts`:

1. Asks the brain to **assess** it, which changes each student's score and picks one student to reply, or nobody.
2. Runs that student's **reply**, then sends the whole line as a `speech` event, followed by captions at speaking pace.
3. If the lecturer used a student's name, the reply starts straight away, alongside the assessment, to cut the wait.

Ending the class builds the **debrief**. Stats are computed in code, and the coach writes the feedback. Feedback citing a transcript line that doesn't exist is dropped, and if the coach fails, rule-based feedback replaces it.

## Where things are

| Path | Purpose |
| --- | --- |
| `src/lib/meeting/types.ts` | The JSON protocol shared by browser and server. Start here |
| `src/lib/meeting/students.ts` | Student personas, topics and misconceptions |
| `server/room.ts` | One class: scores, turn-taking, coaching, debrief |
| `server/brain.ts` | The `AgentBrain` interface: assess, generate, debrief |
| `server/claudeBrain.ts`, `server/prompt.ts` | Claude-powered brain and all its prompts |
| `server/scriptedBrain.ts` | Free rule-based brain |
| `server/classStats.ts` | Question classification, coaching tips, fallback feedback |
| `server/voices.ts` | ElevenLabs voices and transcription tokens |
| `server/app.ts`, `server/validate.ts` | WebSocket server, origin check, message validation |
| `src/lib/meeting/useMeeting.ts` | Class state in React |
| `src/lib/voice/` | Live transcription, push-to-talk fallback, voice playback |
| `src/lib/media/` | Mic, camera and screen streams, and screen snapshots |
| `src/components/MeetingRoom.tsx` | The in-call screen; most UI wiring is here |
| `src/components/Classroom.tsx`, `VoiceVisualizer.tsx` | The default lecture-hall layout, and the ring that pulses with a speaking voice |
| `src/components/DebriefScreen.tsx` | The debrief |

## Rules that aren't obvious

**Protocol:** when adding a message, update `types.ts`, `server/validate.ts` (all socket input is untrusted and checked field by field), the reducer in `useMeeting.ts`, and tests.

**Privacy of scores:** scores, coaching tips and the debrief go only to the lecturer, through `toLecturer`. Student mood emoji (`src/lib/meeting/mood.ts`) are worked out from the scores in the browser, so they're shown only to the lecturer and hidden in realistic mode. The first person to join is the lecturer, and only they can teach or manage students. Anyone else in the room is an observer whose words don't affect the class.

**Student behaviour:**
- Students stay in character, never act as helpful assistants, and don't explain better than their score allows.
- Personas are fictional and must stay respectful. Ana's background shows up as asking about idioms, never as broken English. Don't turn a background into a joke or the cause of struggling.
- Each student has an `aptitude` (1-5) separate from their starting score. It scales score changes in `room.ts` (`LEARNING_RATE`) and sets how they reason in the prompts. Keep a spread of abilities, and don't stack low ability onto a student who is already shown struggling for another reason.
- Debrief feedback must cite real transcript lines, and the tone is a mentor's, not a grader's. This is practice, not a formal assessment.

**Hands and chaos:** in a cooperative or typical class, a student the orchestrator picks raises a hand instead of speaking, keen students raise one after a question, and a student who just got confused (a drop of 5, or 8 for quiet students, or falling below 30) raises one to ask. Saying their name or the `agent.callOn` command (clicking the hand) lets them speak what they raised it for. A hand left up for 4 lecturer turns goes down, and an ignored confused hand becomes a missed signal. Greetings and chat are answered directly. In a chaotic class nobody raises a hand: the chosen student speaks, another may talk over them, and someone may call out unprompted (`random` in `RoomOptions` makes this testable).

**Speech:**
- `speakable()` in `room.ts` removes stage directions and caps replies at 35 words. It only strips brackets that stand alone, because code and maths like `O(n)` and `arr[i]` must survive. This matters in a computer science class.
- A student's transcript line is added when they *start* talking and holds only the words said so far, so interruptions land in the right order.
- `/speech/<id>` sends a CORS header for allowed origins, so the page can measure the voice for the visualiser. A suspended audio context isn't used, because routing through it would silence the voice; the ring then animates on its own.
- The mic is gated while a student's voice plays, so the class can't hear itself, and loud speech over a student cuts them off. See `useLiveTranscription.ts` and `useStudentVoices.ts`.

**Claude API:**
- The app's default model is `claude-opus-5-5`, but live classes need `AGENT_MODEL=claude-haiku-5-5` (set in `.env.example`) for speed.
- On Haiku, thinking is turned off for latency, and the server-side refusal fallback is left out because Haiku doesn't support it. See `speed` and `fallback` in `claudeBrain.ts`.
- Model APIs change often. Check current docs rather than relying on memory, and use the official `@anthropic-ai/sdk`.

**ElevenLabs:**
- A key may lack the `voices_read` permission. Listing voices then fails with a 401, and `DEFAULT_VOICES` in `voices.ts` are used instead.
- ElevenLabs is retiring its default voices on 31 December 2026, so don't assume those IDs will sound the same. Override any with `ELEVENLABS_VOICE_<STUDENT>`.

**Next.js:** this is Next 16, which differs from older versions. Read `node_modules/next/dist/docs/` before relying on memory. For example, route `params` must be read inside `<Suspense>`, and visited routes can stay alive while hidden, so effect cleanups must also reset state.

## Testing tips

- Every model call in `npm test` is faked. Claude and ElevenLabs request shapes are checked against local stand-in servers, so passing tests say nothing about how realistic students are. To judge that, teach a real class.
- Claude Code's built-in browser pane blocks real mic, camera and screen capture. To test there, override `getUserMedia` and `getDisplayMedia` from the page with synthetic streams.
- A page in a hidden pane or background tab can stay blank because animation frames don't fire. Show the page before concluding the app is broken.
- Run `npm run server` as well as `npm run dev`. Without it, the UI just shows "Connecting to the class server…".
- Restarting the server clears all classes, because they're held in memory.

## Status

**Working, and tested live with real services:** synthetic lecturer audio transcribed by ElevenLabs, Claude students replying in character, ElevenLabs voices, reading a shared screen (with a synthetic slide), and the Claude-written debrief.

**Not yet tested:**
- A real microphone, and echo through real speakers. Headphones are the safe choice until this is tried.
- How the default voices sound, and whether each suits its student.
- Sharing a real window or PowerPoint, especially for a long time, since Chrome may slow the class tab while it's hidden.
- Whether students stopped overusing "um" after the latest prompt change.

**Known gaps:**
- **No sign-in.** Anyone with a link can join and spend the server's API credit. Add authentication before putting this online.
- **Speed:** a reply takes about 1.3-2 seconds to start when a student is named, and about 4 seconds otherwise, measured from a typed question. Speech adds the pause used to detect the end of a turn. The goal is under 3 seconds.
- **Memory:** classes and debriefs are lost on restart. Students see only the current screen, and the debrief coach doesn't see slides.
- **Not built:** emotion cues in voices, and a review view where an experienced lecturer checks flagged sessions.
- **People:** camera, mic and screen aren't shared between humans. Observers see only avatars and captions.

## Design direction

The layout is a generic video call: don't copy Google Meet, Zoom or Teams branding or logos. Keep the UI simple and spend the effort on student behaviour. Use 3-5 students, since more is hard to follow.
