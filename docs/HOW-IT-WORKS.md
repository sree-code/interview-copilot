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
4. The main process streams each source to AssemblyAI over its own WebSocket.

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
| **Ask AI** (Alt+Shift+A) | The whole conversation (lines with the eye icon on) + enabled screenshots → best next answer |
| **Screen** (Alt+Shift+E) | Screenshots (Alt+Shift+S) + text read from them (OCR) → answer to what's on screen, e.g. a coding problem |
| **Suggest** (Alt+Shift+G) | The transcript → what to say next |
| ⋯ → Notes / Insights | The conversation → meeting notes / insights |
| ⋯ → Answer the last question now | Forces the fast-mode answer for the latest question |
| Eye icon on a line | Includes or excludes that line from AI context |
| Hide (Alt+Shift+X) | Hides the window instantly |
| Compact (Alt+Shift+M) | Small strip with only the interviewer's latest line and the latest answer, at the top center under the webcam |
| Under webcam (Alt+Shift+W) | Moves the window to the top center of its screen |
| Settings → Window → Panel background | Fades only the background (text stays solid) so you can see the interviewer through it |

The window is excluded from screen sharing (`setContentProtection`, on by default via `HIDE_FROM_SCREEN_CAPTURE=true`). On Windows 10 version 2004 and newer, and on Windows 11, it's left out of the capture entirely.

## 6. Where things are stored
| What | Where |
|---|---|
| Keys, provider, model, opacity, theme | `cache/app-state.json` in dev; `%APPDATA%\Meeting Assistant\` (Windows) or `~/Library/Application Support/Meeting Assistant/` (macOS) when installed |
| Profile, prepared Q&A, session history | `<that folder>/interview/` |
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
