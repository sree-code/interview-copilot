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
2. In the app, click the **gear (Settings)** button.
3. **AI Provider:** choose **Fast cloud model (Groq, OpenAI, Cerebras…)**, pick **Groq**, paste your Groq key. Model: `openai/gpt-oss-20b` (fastest in testing).
4. **AssemblyAI API Key:** paste your AssemblyAI key.
5. **Interview profile:**
   - Fill in your name, current role, target company and job title.
   - **Job description:** paste it or click **Import file**.
   - **Resume:** click **Import PDF**.
   - **Prepared Q&A:** click **Import PDF** and choose your Q&A file (format: `Q: ...` / `A: ...`, see README).
   - Tick **Fast mode** so answers appear automatically.
6. Click **Save Settings**.

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

## Shortcuts

| Keys | Action |
|---|---|
| Alt+Shift+T | Start / stop transcription |
| Alt+Shift+A | Ask AI |
| Alt+Shift+S | Screenshot |
| Alt+Shift+E | Screen AI (answer from screenshot) |
| Alt+Shift+G | Suggest |
| Alt+Shift+H | Show / hide window |
| Alt+Shift+Arrows | Move window |
| Alt+Shift+1…4 | Window size presets |
| Alt+Shift+C | Clear chat |

If you have more than one keyboard language, `Alt+Shift` may also switch languages. Turn that off under **Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys**.

---

## Updating

- **Option A:** download the newest build (steps 2–6) and run the installer again. Your settings stay.
- **Option B:** in the `interview-copilot` folder run `git pull`, `npm ci`, then `npm start`.
