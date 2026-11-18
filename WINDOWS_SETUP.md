# Windows setup, step by step

For a Windows 10 or 11 PC. Takes about 15 minutes.

You need two API keys (both have free tiers):
- **AssemblyAI** (live transcription): https://www.assemblyai.com/dashboard → API Keys
- **Groq** (fast answers): https://console.groq.com/keys → Create API Key

---

## Option A: install the ready-made app (easiest)

1. On the Windows PC, sign in to https://github.com (downloading build files requires a GitHub sign-in).
2. Open https://github.com/sree-code/interview-copilot/actions/workflows/windows.yml
3. Click the newest run with a green check mark.
4. Scroll down to **Artifacts** and click **meeting-assistant-windows** (about 270 MB zip). Files are kept for 14 days; if none is listed, see "Get a fresh build" below.
5. Open the downloaded zip and copy `MeetingAssistant-Setup-<version>.exe` out to your Desktop.
6. Double-click it. If Windows shows "Windows protected your PC", click **More info → Run anyway** (the app isn't code-signed).
7. It installs for your user only (no admin needed) and starts. Go to **First-time setup** below.

**Get a fresh build:** on the page from step 2, click **Run workflow → Run workflow**, wait about 8 minutes, then continue from step 3.

---

## Option B: run from source

1. Open **PowerShell** (Start menu → type `PowerShell`).
2. Install Git and Node.js:
   ```powershell
   winget install --id Git.Git --exact
   winget install --id OpenJS.NodeJS.LTS --exact
   ```
   Close PowerShell and open it again so the new commands are found.
3. Check they work:
   ```powershell
   git --version
   node --version
   ```
4. Download the code and install:
   ```powershell
   cd $HOME\Desktop
   git clone https://github.com/sree-code/interview-copilot.git
   cd interview-copilot
   npm ci
   ```
5. Start the app:
   ```powershell
   npm start
   ```
   Or build your own installer with `npm run build:win` → it appears in the `dist` folder.

---

## First-time setup (both options)

1. **Allow the microphone:** Windows **Settings → Privacy & security → Microphone** → turn on **Microphone access** and **Let desktop apps access your microphone**.
2. In the app, click the **gear (Settings)** button (or **Open settings** on the yellow banner).
3. **AI & keys** tab → **AI provider:** choose **Fast cloud model**, Service **Groq**, paste your Groq key. Model: `openai/gpt-oss-20b` (fastest in testing).
4. **AssemblyAI API Key:** paste your AssemblyAI key.
5. **Interview** tab:
   - Fill in your name, current role, target company and job title.
   - **Job description:** paste it or click **Import job description**.
   - **Resume:** click **Import resume PDF**.
   - **Prepared Q&A:** click **Import Q&A file** and choose your Q&A file (format: `Q: ...` / `A: ...`, see README).
   - Turn on **Answer automatically** (fast mode).
6. Click **Save settings** on the AI & keys tab and **Save profile** on the Interview tab.

Everything is saved in `%APPDATA%\Meeting Assistant` and kept across restarts and updates.

---

## Test before a real interview

1. Put on **headphones** (keeps the interviewer's voice out of your mic).
2. Open a YouTube interview video, or a test call with a friend.
3. Press **Alt+Shift+T** to start transcription. Interviewer lines should appear within about half a second of them finishing; answers follow right after.
4. Ask a question that's in your prepared Q&A: your own answer should appear instantly.
5. Press **Alt+Shift+T** again to stop.

If no interviewer text appears: make sure sound plays through your **default** output device (Windows **Settings → System → Sound → Output**), then restart the app.

---

## Setting up the screen for a real interview

1. **Check that the window is hidden from screen sharing.** It needs Windows 10 version 2004 or newer, or Windows 11. Before your first real interview, start a test call (or a Teams/Zoom recording), share your **entire screen**, and check that the assistant window doesn't appear in what's shared.
2. **Compact mode:** press **Alt+Shift+M** (or the shrink icon in the top bar). The window becomes a small strip at the top center of the screen, right under the webcam. It shows only the interviewer's latest line and the latest answer, in larger text. Reading there looks like eye contact. Press **Alt+Shift+M** again for the full view.
3. **See-through background:** Settings → **Window** → **Panel background**. Around 30–50% lets you see the interviewer's video through the window while the text stays solid.
4. **In the meeting app,** use speaker view and put the interviewer's video right below the strip, near the top center of the screen.
5. Drag the strip by its top line to move it. Drag its edges to resize it. **Alt+Shift+W** puts it back under the webcam.

---

## Shortcuts

| Keys | Action |
|---|---|
| Alt+Shift+T | Start / stop transcription |
| Alt+Shift+A | Ask AI |
| Alt+Shift+S | Screenshot |
| Alt+Shift+E | Screen AI (answer from screenshot) |
| Alt+Shift+G | Suggest |
| Alt+Shift+H | Show / hide window |
| Alt+Shift+M | Compact mode (latest answer only) on / off |
| Alt+Shift+W | Move window to top center, under the webcam |
| Alt+Shift+Arrows | Move window |
| Alt+Shift+1…4 | Window size presets |
| Alt+Shift+C | Clear chat |

If you have more than one keyboard language, `Alt+Shift` may also switch languages. Turn that off under **Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys**.

---

## Updating

- **Option A:** download the newest build (steps 2–6) and run the installer again. Your settings stay.
- **Option B:** in the `interview-copilot` folder run `git pull`, `npm ci`, then `npm start`.
