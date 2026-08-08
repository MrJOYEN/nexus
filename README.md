# Nexus

One window for all the web apps you keep open all day.

Nexus is a lightweight desktop hub for Windows. Each service runs in its own
isolated session, side by side in a single window, with native notifications
and unread counters.

## Why

Two problems, one tool.

**Tab overload.** The apps you live in (WhatsApp, Discord, your mail, your
calendar) end up scattered across fifty browser tabs, and you hunt for the
right one every time. Nexus pins them in a sidebar. One click, or `Ctrl+1` to
`Ctrl+9`, and you are there.

**One account per browser.** A browser only keeps one WhatsApp Web session
alive at a time. Nexus gives every service its own isolated session, so three
WhatsApp accounts on three numbers stay signed in together, next to two
Discord accounts and anything else. They never sign each other out.

## Features

- Isolated session per service: cookies, storage and logins never mix
- Native Windows notifications, with per-service mute (sound included)
- Unread badges in the sidebar, on the taskbar icon and on the tray icon
- A catalogue of popular services with their real logos, plus any custom URL
- Drag and drop ordering, keyboard shortcuts, close to tray
- Per-service sleep to free memory, manual or automatic
- Automatic updates through GitHub Releases
- English, French and Spanish interface

## Install

1. Download the latest `Nexus-Setup-x.y.z.exe` from the
   [Releases page](https://github.com/MrJOYEN/nexus/releases).
2. Run it. Windows SmartScreen will warn about an unknown publisher because
   the installer is not code signed: choose "More info", then "Run anyway".
3. On first launch, pick your language and the services you use. Everything
   can be changed later.

To add a service afterwards, click the `+` button at the bottom of the
sidebar. Right click any icon in the sidebar to edit, reorder, mute or
remove it.

## Shortcuts

| Keys | Action |
| ---- | ------ |
| `Ctrl+1` to `Ctrl+9` | Switch to the Nth service |
| `Ctrl+N` | Add a service |
| `Ctrl+R` | Reload the active service |
| `Ctrl+Q` | Quit (the close button only hides to the tray) |
| `Alt` | Show the menu bar |

## Build from source

Requires Node.js 20 or newer.

```bash
npm install
npm start        # run in development
npm run build    # build the Windows installer into dist/
```

Architecture notes, design decisions and troubleshooting live in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Issues and pull requests are
welcome.

## License

[MIT](LICENSE)
