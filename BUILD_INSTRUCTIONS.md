# Build Instructions

## Quick start

```bash
npm install
npm run build
```

`npm run build` picks your platform (`--win portable`, `--mac` or `--linux`) and writes the app to `dist/`. There are no native node modules to compile.

A specific target from any host:

```bash
npm run build:win     # dist/MeetingAssistant-<version>.exe (portable)
npm run build:mac
npm run build:linux   # AppImage
npm run build -- --win nsis   # Windows installer instead of portable
```

## Identity

| Field | Value |
|---|---|
| Product name | Meeting Assistant |
| App ID | `dev.local.meeting-assistant` |
| Icon | Electron default |

To use your own icon, add `assets/icon.ico`, `assets/icon.icns` or `assets/icon.png` and set `build.win.icon`, `build.mac.icon` or `build.linux.icon` in `package.json`. Use artwork you own. Don't use another company's name, logo or publisher name.

## API keys

`.env` is only read in development (`npm start`). It is **not** copied into builds, so a shared build never carries your keys. In a built app, enter the keys in Settings; they are saved in the app's user-data folder.

## Mobile companion

The phone companion server listens on port 7823 and needs a pairing token. Use the full URL shown in the app, including `?t=…`. Set `MOBILE_SERVER=off` to disable it.
