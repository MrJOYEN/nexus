# Development notes

Everything a contributor needs: how the app is put together, the decisions
that are not obvious from the code, and the traps we already fell into so you
do not have to.

## Layout

```
main.js            main process: window, sessions, views, menus, IPC
preload.js         contextBridge surface (window.hub), the only renderer API
renderer/          the sidebar UI: vanilla HTML/CSS/JS, no framework
services.js        shared constants (Chrome UA string, per-service defaults)
catalog.js         the "known services" list offered in the add form
catalog-icons.js   fetching and caching of catalogue logos
images.js          image format sniffing and ICO/WebP helpers
i18n.js            translations, loaded in the main process only
locales/           en.json (reference), fr.json, es.json
assets/            app icon used at runtime (brand sources in assets/brand)
installer/         electron-builder buildResources: exe icon, installer artwork
```

The window is a `BrowserWindow` whose own webContents renders the sidebar.
Each service is a `WebContentsView` laid over the content area, offset by the
sidebar width. Only the active view is visible, plus a second one on the
right half when split view is on. Security settings are the same everywhere:
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

The service list itself lives in `config.json`
(`%APPDATA%\Nexus\config.json`), not in code. It is created by the first-run
onboarding and edited from the app.

## Sessions

Every service gets `session.fromPartition('persist:<id>')`. Different
partitions mean fully separate cookies, localStorage, IndexedDB and service
workers. That is the core feature: several accounts of the same site stay
signed in at once.

Two related details:

- The `persistent-storage` permission is granted. Without it Chromium may
  evict a site's IndexedDB under disk pressure, which signs the account out.
- `backgroundThrottling: false` on every view, otherwise Chromium throttles
  timers and WebSockets of hidden views and background services miss their
  notifications.

## WhatsApp and the User-Agent

WhatsApp Web rejects browsers whose User-Agent contains "Electron". Services
flagged `spoofUserAgent` get a standard Chrome desktop UA, applied both as
the session UA and in `onBeforeSendHeaders`. The `sec-ch-ua*` Client Hint
headers are stripped as well, because they reveal Electron even when the UA
string is clean.

## Notifications and mute

Muting a service has to close four doors, not one:

1. `window.Notification`, wrapped inside the page via `executeJavaScript`
   (a preload cannot touch the page's `window` under contextIsolation).
2. `ServiceWorkerRegistration.showNotification`, wrapped the same way.
3. The Chromium permission itself, denied while muted, which covers push
   events handled entirely inside the service worker.
4. Page audio. WhatsApp plays its chime itself through the audio API, outside
   the notification system entirely, so mute also calls `setAudioMuted`.
   Consequence: a muted service is silent during calls too.

The wrapper is installed on `dom-ready`, before the site keeps a reference to
the native constructor. After that only a flag flips, so mute is instant.

## Unread badges

The only reliable, stable source is the page title: `(3) WhatsApp`,
`(1) Discord`. Parsing the DOM instead would break at every redesign. Keep in
mind that the number means whatever the service wants it to mean: WhatsApp
counts unread conversations, not messages.

A title with a marker but no number (`• Discord`) shows a dot badge. Totals
are drawn on canvas in the renderer and pushed to the taskbar overlay icon
and to the tray icon (Windows has no `setBadgeCount`).

## Sleep (hibernation)

A sleeping service is destroyed: its Chromium process is gone and so are its
badges and notifications until it is reopened. That is the honest trade-off;
a service that notifies is a service that runs. The auto-sleep countdown
starts when a service leaves the foreground and is cancelled when it comes
back. Do not rearm it on every service switch or nothing ever sleeps for an
active user. A service shown in the right half of split view counts as
foreground: visible services never sleep.

## Split view

`splitId` designates a second service laid on the right half of the content
area; `activeId` keeps the left half and stays "the active service"
everywhere else (shortcuts, badges, menus). Clicking the tile of the service
already shown on the right swaps the two halves instead of showing it twice.
The pair survives restarts (`splitId` is persisted) and split closes itself
when its service is deleted.

## App lock

A lock screen in the sidebar renderer covers the whole window while every
`WebContentsView` is hidden (they are native layers: anything drawn by the
renderer would stay under them). The code is stored as scrypt hash + salt in
the config, verified in the main process only. While locked, service
switching and app shortcuts are ignored.

Be honest about what this is: a privacy screen, not encryption. The sessions
on disk stay readable outside Nexus. A forgotten code is removed by deleting
the `lock` section from `%APPDATA%\Nexus\config.json`; services stay signed
in. Auto-lock listens to `powerMonitor` (`lock-screen`, `suspend`) and polls
`getSystemIdleTime` every 30 s for the idle timeout, because idleness is not
an event.

A single service can also require the code on its own (right click, "Require
the code"). A protected service keeps loading in the background, badges and
notifications included; only its view stays hidden behind a code screen that
covers the content area, sidebar still usable. Unlocking lasts until the app
locks again (`unlockedIds` is cleared by `lockApp`), and the service you are
currently looking at never locks itself under your eyes when you flip the
toggle or set the first code.

## Spell checking

Chromium's own spell checker, enabled per session. Languages follow the
interface language plus English, filtered by
`availableSpellCheckerLanguages`; dictionaries are downloaded on demand into
the profile. Suggestions live in a context menu attached to each view, shown
only in editable fields: elsewhere many web apps (Discord, Notion) draw
their own menu and a second one on top would be noise. Menu actions call
`wc.cut()` and friends explicitly rather than menu roles, because a role
targets the focused webContents, not necessarily the one that was clicked.

## Start with Windows

`app.setLoginItemSettings`, applied only when packaged (in dev it would
register electron.exe). The "start hidden" option passes `--hidden`, which
skips the initial `show()` and leaves the app in the tray; a saved maximized
state is applied on the first real show, because `maximize()` would reveal
the window.

## Icons

Priority for a service icon: user-picked image, then `icon` declared on the
service, then the site favicon, then coloured initials. Favicons are compared
by real pixel size, not file size, and the best score is kept for the whole
page load because sites announce several favicons in no particular order
(Discord announces its vector icon first, then a 16px canvas version with an
unread counter drawn in).

Catalogue logos are fetched from each service's site (apple-touch-icon, the
DuckDuckGo icon service, favicon.ico, then the root domain as fallback),
cached in `%APPDATA%\Nexus\catalog-icons.json` and refreshed monthly.
Prefetch starts right after launch so the grid is warm before the add form
ever opens. Nothing is bundled: bundled logos go stale.

The cache key is the domain, except for entries with a declared `icon`
source, which get their own key. Gmail and Google Chat both live on
mail.google.com; a shared key made Gmail wear the Chat logo. The cache file
carries a version number: bump it when fetching logic changes, or wrong
entries survive for a month. Declared sources also cover services whose
detectable icons are 32px, too soft for a 44px tile on a HiDPI screen.

Hard-earned lessons encoded in `images.js`:

- Sniff formats from magic bytes; servers lie about content types.
- A single-page app answers 200 with its `index.html` on any unknown path,
  so an "icon" that starts with `<` may be a web page, not SVG.
- WhatsApp serves its favicon as WebP, which `nativeImage` cannot measure;
  the dimensions are read from the RIFF header directly.
- A `.ico` is a container with the same icon at many sizes. Keep the smallest
  frame that is large enough (128px), not the whole file.

## i18n

English is the reference locale and the fallback. The main process alone
reads `locales/*.json`; the sandboxed renderer receives the resolved
dictionary at bootstrap. Static labels carry `data-i18n` attributes filled
before first paint. Language lives under File in the menu bar, is chosen
during onboarding, and switches live: menus and tray are rebuilt, the
sidebar re-translates in place, services are untouched.

To add a language: copy `locales/en.json`, translate, add the code to
`AVAILABLE` in `i18n.js` and its native name to `LANGUAGE_NAMES` in
`main.js`.

## Updates and releases

`electron-updater` checks GitHub Releases at startup and every four hours,
downloads in the background, and installs only on explicit user action.

```bash
npm version patch
set GH_TOKEN=<token with repo scope>
npm run release
```

`npm run build` stays local. The `.blockmap` next to the installer enables
differential updates and must ship with every release. The app is not code
signed, so updates are not signature-verified: anyone controlling the
repository could push a version. Known trade-off of unsigned distribution.

## Packaging

`build.files` in `package.json` is include-everything with targeted
exclusions. It used to be a whitelist of filenames, and two installers
shipped without newly added modules and died on startup. New files must ship
by default. After touching packaging, do not trust a green build: run
`dist/win-unpacked/Nexus.exe` with a scratch `--user-data-dir` and check that
it creates its profile.

Related trap: electron-builder silently excludes the `buildResources`
directory from the packaged app. It once pointed at `assets/`, so the
installer built fine and the app ran, but `assets/icon.ico` did not exist at
runtime: blank tray icon, no logo on the onboarding and lock screens. Hence
the split: `assets/` ships with the app, `installer/` (buildResources) feeds
electron-builder only, and the icon exists in both.

## Development tips

- **Isolated profile.** Dev and the installed app share `%APPDATA%\Nexus`
  and a single-instance lock. Use
  `npx electron . --user-data-dir="%TEMP%\nexus-test"` for a scratch profile;
  it is also the only way to test onboarding without wiping your real config.
- **`ELECTRON_RUN_AS_NODE`.** Some IDE terminals export it. Electron then
  boots as plain Node, `require('electron')` returns no API and the app dies
  on the first `app.` call (or the packaged exe rejects Chromium flags with
  "bad option"). Unset it.
- **App identity.** The AppUserModelID differs between dev and packaged
  (`com.mehdi.nexus.dev` vs `com.mehdi.nexus`). Windows resolves that ID to a
  Start Menu shortcut and borrows its icon and label for the taskbar; when
  both claimed the same ID, the stray dev shortcut hijacked the installed
  app's identity.
- **Menu accelerators.** App shortcuts are handled in `before-input-event`
  on the sidebar and on every service view. Menu items display their shortcut
  with `registerAccelerator: false`; otherwise each keypress fires twice.
- **Keyboard layouts.** Match digits on `input.code` (`Digit1`..`Digit9`),
  never on `input.key`: an AZERTY top row produces `& é "` without Shift, so
  `Ctrl+1` never carries the character "1". And ignore events with
  `input.alt` set, because AZERTY's AltGr arrives as Ctrl+Alt and typing
  `~ # { [` inside a service would trigger the shortcuts.
- **Native layers win.** A `WebContentsView` sits above the page, so nothing
  the sidebar draws can overlap it. Tooltips are native `title` attributes,
  and the active view is hidden while the add form is open.

## Troubleshooting

**WhatsApp shows "browser not supported".** The UA spoof is on for flagged
services; if WhatsApp tightens the check, bump the Chrome version in
`CHROME_UA` (`services.js`), clear the partition under
`%APPDATA%\Nexus\Partitions`, and reload.

**Two accounts sign each other out.** Their services share a partition. This
cannot happen through the app (each new service gets its own); it only
happens after hand-editing `config.json`.

**No Windows notifications.** Check the site's own notification setting
first, then Windows Settings > Notifications, then that the app was quit
rather than hidden to the tray. In dev, toasts may show "Electron" as the
sender; the installed app shows Nexus.

**A service hangs on loading.** Fifteen-second timeout, then a Retry button.
`Ctrl+Shift+I` opens the service devtools to see the real error.
