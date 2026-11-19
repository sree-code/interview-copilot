# Interview Copilot: set it up with Claude in 20 minutes

A desktop app that listens to your interview or practice call, writes down what the interviewer says, and shows you a short answer in your own words a moment after they finish. Your prepared answers come first, and the rest is written by a fast AI model using your resume and the job description.

Use it to **practice** (mock interviews, YouTube interview videos, friends asking you questions) and only in real interviews where AI help is allowed. Many companies don't allow it, so check first.

---

## Part 1: for you

### What you need

| | |
|---|---|
| A computer | Windows 10 (version 2004 or newer) or Windows 11. A Mac with macOS 14.2 or newer also works. |
| Claude Code | Anthropic's coding assistant. It needs a paid Claude plan (Pro or higher). Easiest option: the **Claude desktop app**, Code tab (download from https://claude.com/download). Or the terminal version (Windows PowerShell: `irm https://claude.ai/install.ps1 \| iex`, Mac: `curl -fsSL https://claude.ai/install.sh \| bash`). |
| An AssemblyAI key | For live transcription. Free to start: https://www.assemblyai.com/dashboard → **API Keys**. |
| A Groq key | For fast answers. Free tier: https://console.groq.com/keys → **Create API Key**. |
| About 20 minutes | Most of it is downloads. |

Copy both keys into a note for now. **Don't paste them into the Claude chat.** You'll paste them straight into the app in step 4, so they never leave your computer except to go to AssemblyAI and Groq.

### Steps

1. **Open Claude Code** in a folder you're happy to put the app in (your Desktop or Documents is fine). In the desktop app, choose the folder when it asks. In a terminal, `cd` there and type `claude`.
2. **Give Claude this PDF.** Drag it into the chat (or type its path) and send:

   > Follow "Part 2: instructions for Claude" in this PDF to install the interview copilot on my computer. Ask me before installing anything.

3. **Say yes** when Claude asks to install Git and Node.js, if you don't already have them. Claude downloads the app, checks it, and starts it. A small window titled *Meeting Assistant* appears at the top of your screen. It opens on a **Welcome to the Interview Copilot beta** screen: read it and click **Accept and continue** (step 7 explains what it sends). Then you'll see a yellow banner saying keys are missing.
4. **Add your keys in the app** (not in the chat): click **Open settings** on the yellow banner.
   - **AI & keys** tab: AI provider **Fast cloud model**, Service **Groq**, paste your Groq key, Model `openai/gpt-oss-20b`. Paste your AssemblyAI key below. Click **Save settings**.
5. **Fill in your profile:** **Interview** tab.
   - Your name, current role, the company and job title.
   - **Job post link:** paste the job's link and click **Import** (or paste the description).
   - **Import resume PDF.**
   - **Prepared Q&A:** if you have a file of your prepared answers (`Q:` and `A:` lines), click **Import Q&A file**. Claude can draft one from your resume if you ask (see Part 2, step 8).
   - Turn on **Answer automatically**, then click **Save profile**.
6. **Allow the microphone** if asked. On Windows: **Settings → Privacy & security → Microphone**, turn on access for desktop apps. On a Mac: allow **Microphone** and **Screen & System Audio Recording** for the app when macOS asks, then restart it.
7. **About the beta screen** from step 3: The beta sends anonymous usage and speed stats (timings, errors, features used, app version, OS, and your country and city estimated from your IP) so the author can fix and speed it up. It never sends what anyone says, your transcripts, answers, profile, resume, files, screenshots or keys. Click **Accept and continue** to use the app; it stays locked until you do (**Quit** closes it).

### Practice

1. Put on **headphones**.
2. Open a mock interview video on YouTube (search for "mock software engineer interview" or similar for your role), or have a friend call you.
3. Press **Alt+Shift+T** (or the **Listen** button). The interviewer's words appear as they speak. About half a second after they finish a question, an answer appears under it: green **Your prepared answer** or purple **Suggested answer**.
4. Say the answer in your own words. The app learns how you talk from what you say, so later answers sound more like you.
5. Press **Alt+Shift+M** for **compact mode**: a small strip under your webcam showing only the latest question and answer, in larger text. Clicks go through it to the meeting app, and it never takes your keyboard.

| Keys | What it does |
|---|---|
| Alt+Shift+T | Start / stop listening |
| Alt+Shift+A | Answer now (closes the interviewer's sentence first) |
| Alt+Shift+M | Compact strip on / off |
| Alt+Shift+Left / Right | Previous / next answer |
| Alt+Shift+Up / Down | Scroll the answer |
| Alt+Shift+= / - | Bigger / smaller text |
| Alt+Shift+S, then Alt+Shift+E | Screenshot, then answer from it (coding problems) |
| Alt+Shift+W | Put the window back under the webcam |
| Alt+Shift+D | Move it to your other monitor |
| Alt+Shift+H | Hide to a small faint icon / show (or click the icon) |

The window is hidden from screen sharing on Windows 10 (2004+) and Windows 11. Test it once: share your whole screen in a test call and check that it doesn't appear.

If Alt+Shift switches your keyboard language on Windows, turn that off: **Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys**.

---

## Part 2: instructions for Claude

You are setting up the "Interview Copilot" desktop app (an Electron app) from https://github.com/sree-code/interview-copilot for the person you're talking to. Follow these steps in order. Keep messages short and plain. Explain each step in a sentence before running it.

**Rules**
- Ask before installing any software (Git, Node.js) and before running anything that needs administrator rights.
- **Never ask for API keys in the chat.** The person pastes them into the app's Settings (Part 1, step 4). If they paste a key into the chat anyway, don't repeat it back. Offer to write it into the `.env` file (step 6) so they don't have to type it again, and suggest they rotate the key later, since it's now in the chat history.
- Don't commit, push or upload anything. Don't change the app's code unless a step below says so or the person asks.
- If a step fails, read the error, fix the cause (missing tool, wrong folder, PATH not refreshed), and retry once before asking the person.

**1. Check the computer.** Detect the OS. On Windows run `winget --version`, `git --version` and `node --version`. On a Mac run `git --version`, `node --version` and `brew --version`. Node.js 22 or newer is needed (the app's CI uses Node 24).

**2. Install what's missing** (ask first):
- Windows: `winget install --id Git.Git --exact` and `winget install --id OpenJS.NodeJS.LTS --exact`. Afterwards, open a new shell, or add `C:\Program Files\nodejs` and `C:\Program Files\Git\cmd` to PATH for this session, then check the versions again.
- Mac: `brew install git node`. If Homebrew is missing, ask before installing it from https://brew.sh.

**3. Download the app** into the current folder:
```
git clone https://github.com/sree-code/interview-copilot.git
cd interview-copilot
```
If the folder already exists, run `git pull` inside it instead.

**4. Install and check:**
```
npm ci
npm test
```
`npm ci` takes 2–5 minutes (it downloads Electron). All tests should pass. If `npm ci` fails behind a proxy or antivirus, retry once, then show the person the error.

**5. Start the app:** `npm start`. Run it in the background or in a separate terminal, so you can keep talking with the person. The window appears at the top center of the screen. It first shows a beta welcome screen; tell the person to read it and click **Accept and continue** (the app and its shortcuts stay locked until they do), then continue with Part 1, step 4 (keys in the app's Settings).

Optional, Windows only: if the person wants a normal installed app (Start menu entry, automatic updates), run `npm run build:win`, then run `dist\MeetingAssistant-Setup-<version>.exe`. It installs for this user only, with no admin rights needed. Windows SmartScreen may say "Windows protected your PC": click **More info → Run anyway** (the app isn't code-signed). If the repository has a Releases page with an installer, downloading that is quicker.

**6. Keys from the chat (only if the person gave them to you).** Write them to `interview-copilot/.env` (a plain `KEY=value` file; it's already ignored by git):
```
ASSEMBLY_AI_API_KEY=<their AssemblyAI key>
GROQ_API_KEY=<their Groq key>
FAST_LLM_PRESET=groq
```
On Mac/Linux, run `chmod 600 .env`. Restart the app (stop `npm start` and run it again). Never print the file or the keys.

**7. Profile help (optional).** The person fills in the profile in the app (Part 1, step 5). If they ask, you can help by:
- writing the job description to `interview-copilot/my-interview/job-description.txt`, which they import with **Import job description**;
- pointing them to their resume PDF for **Import resume PDF**.

**8. Prepared answers (optional, recommended for practice).** Offer to draft prepared answers from their resume and the job description, for 10–20 common questions ("Tell me about yourself", "Why this company?", "Biggest challenge", "Why are you leaving?", "Strengths and weaknesses", role-specific technical questions). Write them in first person, in the person's own voice, 3–6 spoken sentences each, using only facts from their resume and anything they tell you. Never invent employers, numbers or projects. Save them as `interview-copilot/my-interview/prepared-answers.txt`, in this format:
```
Q: Tell me about yourself.
A: I'm a ... (answer)

Q: Why do you want to work at <company>?
A: ...
```
Then tell them: Settings → Interview → **Import Q&A file** → choose that file. Ask them to read it and edit anything that doesn't sound like them. That is the point of the practice.

**9. Check it works together.** Ask the person to play a mock interview video with headphones on and press **Alt+Shift+T**. Interviewer lines should appear, with an answer under each question. If nothing appears:

| Symptom | Fix |
|---|---|
| Only the beta welcome screen shows, or shortcuts do nothing | Click **Accept and continue**. The beta needs the usage stats accepted |
| Yellow banner "Add your … key" | Keys not saved: Settings → AI & keys → paste → **Save settings** |
| "AssemblyAI: …" error | Wrong or expired AssemblyAI key, or no credit left on the account |
| No interviewer text on Windows | Sound must play through the **default** output device (Settings → System → Sound → Output); restart the app |
| No interviewer text on a Mac | System Settings → Privacy & Security → **Screen & System Audio Recording** → allow the app (in dev it's "Electron"), then restart it |
| Answers fail with 401/403 | Wrong Groq key |
| Answers fail with 429 | Groq free-tier limit; wait a minute, or choose another model in Settings |
| Alt+Shift shortcuts do nothing or switch language | See the keyboard-language fix in Part 1 |

**10. Finish** by telling the person, in a few lines:
- How to start the app next time: open a terminal in `interview-copilot` and run `npm start` (or use the installed app).
- How to update: `git pull`, then `npm ci`, then `npm start`. The installed Windows app updates itself.
- Where their data is: Settings and keys are on this computer only, in the app's data folder (Windows: `%APPDATA%`; Mac: `~/Library/Application Support`). Use **Start a fresh session** in Settings → Interview to clear the conversation history.

---

*Interview Copilot is a fork of Open-Cluely (MIT license). How it works: `docs/HOW-IT-WORKS.md` in the repository.*
