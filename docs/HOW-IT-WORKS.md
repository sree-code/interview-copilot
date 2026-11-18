# How it works, end to end

```
 Interviewer's voice ──► your speakers/headphones ──► system audio loopback ─┐
 Your voice ──────────► microphone ─────────────────────────────────────────┤
                                                                              ▼
 ┌──────────────────── Window (React + Astryx UI, sandboxed renderer) ────────────────────┐
 │ audio-pipeline: AudioWorklet → 16 kHz mono PCM → 100 ms chunks ──► IPC to main process  │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
                                                                              │
 ┌──────────────────────────────── Main process (Node) ────────────────────────────────────┐
 │ AssemblyAI service: 2 WebSockets (interviewer, mic), streaming v3                        │
 │   partial words ──► window ("Live" line)                                                 │
 │   final line ──► echo filter (mic only: drops the interviewer's voice picked up by mic)  │
 │            ├──► window (chat line, appears at once)                                      │
 │            └──► answer engine (fast mode)                                                │
 │                   waits 350 ms for a continuation of the question                       │
 │                   ├─ matches your prepared Q&A (≥ 0.5)? ──► your answer, instantly       │
 │                   └─ else prompt = profile + resume + job description + notes            │
 │                          + close Q&A matches + earlier Q&A this session                  │
 │                          + 3 samples of how you speak + recent conversation              │
 │                          ──► Groq gpt-oss-20b (streamed) ──► window, word by word        │
 │                   interviewer speaks again mid-answer? ──► cancel, short follow-up answer │
 │ Session store: every line and answer saved to <user data>/interview/session.jsonl        │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. Start-up
1. `src/main.js` → `start-application.js` loads `.env` (from the user-data folder when packaged), the saved app state (keys, provider, model), and the interview data: `profile.json`, `qa-bank.json`, `session.jsonl`.
2. Global shortcuts are registered (`Alt+Shift+…`), the phone companion server starts, and the always-on-top, frameless window opens `app.html`.
3. The window loads the React + Astryx UI (`src/windows/assistant/app`). Its logic layer (`app/engine/session-store.js`) reads settings and the interview state. If you've used it before, it shows "Continuing your session…".

## 2. Listening (Listen / Alt+Shift+T)
1. **Interviewer:** `getDisplayMedia` answered by the main process with loopback audio. That's WASAPI on Windows, with no permission needed, and the CoreAudio tap on macOS 14.2+, which needs Screen & System Audio Recording. Video frames are dropped right away.
2. **You:** `getUserMedia` microphone with echo cancellation.
3. An AudioWorklet converts both to 16 kHz mono PCM and sends 100 ms chunks to the main process.
4. The main process streams each source to AssemblyAI over its own WebSocket. The connection carries up to 100 **key terms** (Settings → Interview → Key terms, plus the company, the role and tech words found in your resume and job description) so names like *Kubernetes* or *gRPC* are spelled right; the **language** (non-English uses AssemblyAI's multilingual model); and, with **Answer timing: Faster**, a shorter end-of-turn silence for the interviewer.

## 3. Transcripts
- **Partials** show as a "Live" line while someone is talking.
- **Finals** go through the echo filter first (mic only): a mic line that repeats what the interviewer just said is dropped.
- The window shows the line at once. Pieces of the same sentence that arrive close together are merged into one line, and an answer always appears below the question it answers.
- Every final also goes to the answer engine.

## 4. Answers (fast mode on)
1. When the interviewer finishes, the engine waits 350 ms in case the question continues.
2. **Prepared answer first:** the question, and each sentence of it, is matched against your Q&A file (TF-IDF with synonyms such as "walk me through your resume" → "tell me about yourself"). A score of 0.5 or more shows your answer instantly, labelled *Your prepared answer*.
3. **Otherwise the model answers:** one prompt with your profile, resume, job description, notes, the closest prepared answers, what was already discussed this session, and three examples of how you actually phrased things. Groq `openai/gpt-oss-20b` streams it in (~0.3 s to first words), labelled *Suggested answer*.
4. **Interruptions:** if the interviewer speaks while an answer is streaming, it's cancelled (marked *Interrupted*), and a short answer to the follow-up is written using the earlier question and the partial answer.
5. What you say after a question is saved as a style sample, so later answers sound more like you.

With fast mode off, nothing answers automatically. Use the buttons instead.

## 5. Buttons and shortcuts
| Action | What it sends to the model |
|---|---|
| **Ask AI** (Alt+Shift+A) | If the interviewer is mid-sentence, their turn is closed first (AssemblyAI `ForceEndpoint`, under a second) so their last words count. Then the whole conversation (lines with the eye icon on) + enabled screenshots → best next answer |
| **Screen** (Alt+Shift+E) | Screenshots (Alt+Shift+S) sent **as images** to a vision model (Groq: `meta-llama/llama-4-scout-17b-16e-instruct`) plus the text read from them (OCR) → answer to what's on screen, e.g. a coding problem. If your key can't use the vision model, it answers from the OCR text. |
| **Suggest** (Alt+Shift+G) | The transcript → what to say next |
| ⋯ → Notes / Insights | The conversation → meeting notes / insights |
| ⋯ → Answer the last question now | Forces the fast-mode answer for the latest question |
| Eye icon on a line | Includes or excludes that line from AI context |
| Hide (Alt+Shift+X) | Hides the window instantly |
| Compact (Alt+Shift+M) | Small strip with only the interviewer's latest line and the latest answer, at the top center under the webcam |
| Under webcam (Alt+Shift+W) | Moves the window to the top center of its screen |
| Previous / next answer (Alt+Shift+Left / Right) | Compact mode shows one answer at a time; flip back to earlier ones. Next on the last one follows the latest again |
| Scroll answer (Alt+Shift+Up / Down) | Scrolls the answer (or the conversation in full view) without touching the window |
| Text size (Alt+Shift+= / - / 0) | Bigger, smaller, reset. Also Settings → Window → Text size |
| Next screen (Alt+Shift+D) | Moves the window to the next monitor; screenshots are then taken of that monitor (Windows) |
| Move window (Ctrl+Alt+Shift+Arrows) | Moves it to the left/right/top/bottom edge |
| Ctrl+Enter / Ctrl+Shift+Enter | Ask AI / screenshot and answer. Off by default (Settings → Window); only registered while listening, so Ctrl+Enter still runs code in coding tools the rest of the time |
| Settings → Window → Panel background | Fades only the background (text stays solid) so you can see the interviewer through it |

The window is excluded from screen sharing (`setContentProtection`, on by default via `HIDE_FROM_SCREEN_CAPTURE=true`). On Windows 10 version 2004 and newer, and on Windows 11, it's left out of the capture entirely.

**In compact mode** (both can be turned off in Settings → Window):
- **Click-through:** clicks pass to the meeting app under the strip, except on its top bar and buttons. The page hit-tests mouse moves (every 40 ms) and tells the main process to ignore or accept the mouse (`setIgnoreMouseEvents(…, { forward: true })`).
- **No focus stealing:** the window can't take keyboard focus (`setFocusable(false)`), so typing in the call or your editor is never interrupted. Buttons still work.

On Windows the window uses the highest always-on-top level and re-applies it every second, so a full-screen Teams or Zoom window can't cover it.

**Call detection:** on Windows, the app checks every 4 s which apps are using the microphone (the same data as Settings → Privacy → Microphone). When Zoom, Teams, Webex, Slack, Discord or a browser call starts and you're not listening, it offers to start. On macOS it notices Zoom meetings only.

**Job post link** (Settings → Interview): fetches the page and fills company, role and job description from its schema.org `JobPosting` data (Greenhouse, Lever, LinkedIn public pages and most career sites), or from the page text.

**Updates:** the installed Windows app checks GitHub Releases every few hours, downloads new versions in the background and installs them on restart. The portable .exe and runs from source update manually.

## Usage stats (required in the beta)
During the beta, sharing anonymous usage and speed stats is a condition of using the app. On first start the app shows what is and isn't sent, with **Accept and continue** or **Quit**. Nothing is sent until you accept, and the app (including its global shortcuts) stays locked until then. This is set by `"required": true` in `src/telemetry-config.json`; set it to `false` to make the stats optional again (ask once, with a switch in Settings → Window → Privacy). With no project key, stats are off for everyone. `COPILOT_TELEMETRY=0` turns them off on a developer machine; they're always off in CI and smoke tests.

| Sent | Never sent |
|---|---|
| Event names: app started/quit, listening started/stopped, answer shown, feature used, errors, crashes, updates, call detected | Transcripts, answers, prompts |
| Timings: start-up, speech-end → transcript, question → first words of the answer (p50/p90 per session) | Your profile, resume, job description, Q&A |
| Which answer source (prepared or model), model name, interrupted yes/no, answer length in characters | File names and paths |
| App version, OS and version, CPU type, memory size, OS language, number of screens | API keys (long token-like strings are redacted even by accident) |
| A random install id; country/city estimated by the stats service from your IP | Error message text (only a category such as `rate_limit` and the HTTP status) |

The events go to the app owner's [PostHog](https://posthog.com) project (`/batch/` endpoint, sent every minute and on quit). The code is in `src/main-process/features/telemetry/`.

## 6. Where things are stored
| What | Where |
|---|---|
| Keys, provider, model, opacity, theme | `cache/app-state.json` in dev; `%APPDATA%\Meeting Assistant\` (Windows) or `~/Library/Application Support/Meeting Assistant/` (macOS) when installed |
| Profile, prepared Q&A, session history | `<that folder>/interview/` |
| Install id and whether you accepted the stats | `<that folder>/telemetry.json` |
| Window preferences (click-through, focus, text size, panel background) | The window's local storage |
| Optional env settings | `.env` in the same folder (dev: project folder) |

"Start a fresh session" (Settings → Interview) clears the session history but keeps your profile and Q&A.

## 7. The UI code
- `src/windows/assistant/app.html` loads `app.bundle.js` / `app.bundle.css`, which `scripts/bundle-preload.js` builds with esbuild on every `npm start` / `npm run build`.
- `app/engine/session-store.js` holds all logic with no DOM code: transcription, messages, AI actions and settings. React components only render its state.
- `app/components/`:
  - `TopBar` (Listen, sources, Ask AI, Screen, Suggest, menu, window buttons)
  - `Conversation` (Astryx Chat components, Markdown answers)
  - `SettingsDrawer` (AI & keys, Interview, Window, Shortcuts, Diagnostics)
- The old UI is still there: start with `LEGACY_UI=1` to use `renderer.html`.
