# Roundtable

A practice classroom for university lecturers and TAs. You join a video-call style class and talk to AI computer science students, each with their own personality and background. They listen to what you say, answer out loud, and react to how well you explain things. A coaching debrief follows.

## Run it

```bash
npm install
```

Copy `.env.example` to `.env` and add your keys. `.env` is git-ignored, so the keys stay out of GitHub.

```bash
cp .env.example .env
```

Run the server and the web app in two terminals:

```bash
npm run server
```

```bash
npm run dev
```

Open http://localhost:3000 in Chrome or Edge, start a class, allow the microphone, and start talking. You can also type at any time. Headphones work best, as they stop students' voices reaching your mic.

To test that your keys work (costs a fraction of a cent):

```bash
npm run check
```

## Keys

| Key | What it does | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Students think and reply using Claude | Scripted lines and simple scoring rules |
| `ELEVENLABS_API_KEY` | Live transcription of your mic, and student voices | The browser's own speech recognition (push-to-talk) and voices |

Both stay on the server. The browser only receives short-lived, single-use transcription tokens, and streams student audio through the server.

`AGENT_MODEL=claude-haiku-5-5` gives the fastest replies. If the key can list your ElevenLabs voices, students are matched to voices on your account; otherwise they use the defaults in `server/voices.ts`. To choose one, set `ELEVENLABS_VOICE_PRIYA=<voice id>`, and likewise for `MARCUS`, `LEO`, `ANA` and `SAMIRA`.

## How a class works

1. **Setup:** the lecturer picks a topic and class mood. Starting the class turns on the mic.
2. **Live class:** ElevenLabs transcribes the mic and detects when you've finished a thought. Each thing you say, or type, changes each student's hidden understanding score (0-100). One student then answers, or nobody does. Address a student by name and they answer straight away.
3. **Sharing your screen:** select Present to share a window, tab or slides. Students see what's on screen now and can answer questions about it. The browser sends a snapshot when the screen changes and just before you speak. Scripted students can't see it.
4. **Talking over students:** the mic is muted to the class while a student talks, so they can't hear themselves. Speak loudly over them and they stop, as they would in a room.
5. **Coaching:** rule-based tips appear privately, such as when a confused student has been quiet. Turn on realistic mode in the Coaching panel to hide tips and scores.
6. **Debrief:** ending the class gives understanding charts, talk-time balance, open and closed questions, missed signals and things to try. Each point links to the moment in the transcript.

## The students

All are fictional. Personas are in `src/lib/meeting/students.ts`.

| Student | Background | In class | Ability (1-5) |
| --- | --- | --- | --- |
| Marcus | Coding bootcamp graduate | Confident, and often wrong | 2: pattern-matches, shallow on the why |
| Priya | Switched from biology | Quiet, and hides being lost behind "yeah, I think so" | 3: slow start, solid once it clicks |
| Leo | Former music producer | Warm, and goes off-topic | 1: concrete thinker, needs several examples |
| Ana | Electrical engineer from Brazil | Strong maths, fluent English, asks about idioms | 4: quick and rigorous |
| Samira | Six years in IT support | Sharp, and asks about edge cases | 5: reasons ahead, bored by vagueness |

Ability is separate from what a student knows at the start. It scales how fast their understanding rises and falls, and how deeply they reason.

## Controlling cost

- **Claude:** each thing you say uses up to two model calls, and ending the class uses one more. A class is limited to 200 calls (`AGENT_MAX_TURNS`).
- **Shared screens:** while you're sharing, the current snapshot is added to each Claude call, which makes those calls cost more.
- **ElevenLabs transcription:** runs for as long as the mic is on during a class, including silence, so turn the mic off during breaks.
- **ElevenLabs voices:** charged per line spoken. Replies are capped at 35 words.

All settings are listed in `.env.example`.

## Current limits

- **Your speech goes to ElevenLabs** for transcription while the mic is on. This app doesn't store your voice; only the transcript text is kept, in the server's memory.
- **Anything you share goes to Claude** while you're presenting, so close anything private first. The server keeps only the latest snapshot, in memory, and clears it when you stop or the class ends.
- **Students only see the current screen.** They don't remember earlier slides beyond what was said aloud, and the debrief coach doesn't see slides at all.
- **No emotion cues.** Student voices don't add tone beyond the words themselves.
- **No lecturer review.** Nothing yet flags a session for an experienced lecturer to review.
- **Practice only.** This isn't a formal assessment of anyone's teaching.
- **There are no accounts.** Anyone with the link can join, and the first person in is the lecturer. Add authentication before putting the server on the internet, because visitors can spend your API credit.
- **Classes are held in memory.** Restarting the server clears them, including debriefs.
- **Video isn't shared with other people.** Your camera stays on your machine, and students can't see it. Other people joining the link see only captions and avatars, not your screen.

## Tests

```bash
npm test
```

These run the real server over WebSockets with a fake student brain. `ClaudeBrain` and the ElevenLabs voices are tested against local stand-ins, so the tests don't call either service or spend anything. `npm run check` is the one that uses real services.

## Where things are

| Path | Purpose |
| --- | --- |
| `server/room.ts` | One class: scores, turn-taking, coaching, debrief |
| `server/brain.ts` | The interface behind the students: assess, reply, debrief |
| `server/claudeBrain.ts`, `server/prompt.ts` | Claude-powered students and coach, and their prompts |
| `server/scriptedBrain.ts` | Free rule-based students |
| `server/classStats.ts` | Question classification, coaching rules, fallback feedback |
| `server/voices.ts` | ElevenLabs voices and transcription tokens |
| `server/app.ts`, `server/validate.ts` | WebSocket server and message checks |
| `server/check.ts` | Tests the real services |
| `src/lib/voice/` | Live transcription, push-to-talk fallback, playing voices |
| `src/lib/media/useScreenFrames.ts` | Sending snapshots of a shared screen |
| `src/lib/meeting/students.ts` | Student personas, topics and common misconceptions |
| `src/lib/meeting/types.ts` | The protocol shared by browser and server |
| `src/components/DebriefScreen.tsx` | The debrief |
| `src/components/` | The rest of the interface |
| `src/lib/brand.ts` | The placeholder product name |
