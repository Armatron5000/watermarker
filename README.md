# Watermarker

A cross-platform desktop app that lets you open a local image, add a text watermark, position and style it in a live preview, and save a flattened copy in the original file format.

Built with **Electron + TypeScript + Vite** (`electron-vite`), targeting Windows, macOS, and Linux.

## Summary

- **Input/output formats (fixed set):** PNG, JPEG, WebP, TIFF, GIF. Anything else is rejected at open time.
- **Output type is locked:** the saved file always keeps the source format; the user cannot change it.
- **Animated GIF / multi-frame TIFF:** a warning is shown and the watermark is flattened into the first frame (result is single-frame).
- **Watermark:** any locally installed OS font (enumerated via `font-list`); up to 100 Unicode characters; multi-row via line breaks and/or word-wrap.
- **Interactive editor:** drag to move, corner handles to resize (font size + wrap width), handle to rotate (Shift snaps to 15°), click to edit text in place.
- **Open by drag-and-drop:** drop an image anywhere in the window to open it; the empty-state shows a dedicated Open button and drop hint.
- **Preview matches output:** text is drawn in the renderer (Chromium/Skia), and EXIF orientation is honored via sharp `.rotate()` (oriented dimensions are reported to the editor so the full-res text layer lines up).

## Architecture

Secure 3-tier split (per `PLAN.md`):

```
Renderer (web UI/editor)  ↔  Preload (typed IPC bridge)  ↔  Main (Node)
─────────────────────────      ────────────────────────      ────────────────
live preview, text layer       contextBridge / ipcRenderer    dialogs, font-list,
(fonts drawn with Skia)        contextIsolation: true         all sharp decode/
                               sandbox: true                  composite/encode
                               nodeIntegration: false
```

- The typed IPC contract lives in `src/shared/ipc.ts` and exposes exactly five whitelisted channels: `list-fonts`, `open-image`, `save-image`, `get-frame-count`, `render-text-layer`. Drag-and-drop reuses `open-image` with an optional `{ path }` (the dropped file's path is resolved in the sandboxed preload via `webUtils.getPathForFile`, a non-IPC bridge helper); `open-image` rejects unsupported formats and reports EXIF-oriented dimensions.
- At save time the renderer draws the watermark onto an offscreen canvas, exports a transparent PNG, and the main process composites it with sharp and encodes to the source format.

## Prerequisites

- Node.js 22.12+ and npm
- On Linux, a display server and fonts installed locally (e.g. a desktop session)

## Getting started

```bash
npm install
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run the app in development mode with HMR |
| `npm run build` | Typecheck, then build main/preload/renderer into `out/` |
| `npm run start` | Preview the built app (like production without packaging) |
| `npm run typecheck` | Run TypeScript checks for main/preload and renderer |
| `npm run spike` | Run the feasibility spike test suite (evergreen, no app UI) |
| `npm run icon` | Regenerate `build/icon.png` (source for all platform icons) |
| `npm run pack` | Build and produce an unpacked app directory in `release/` |
| `npm run dist` | Build and package installers for the host OS |
| `npm run dist:linux` / `dist:mac` / `dist:win` | Package for a specific OS |

To run the tests:

```bash
npm run spike
```

This exercises all 5 formats against sharp (round-trip format/dimension preservation, the composite pipeline, first-frame flattening for animated GIF/multi-frame TIFF, EXIF `.rotate()` handling) and verifies `font-list` enumeration. Last run: 40/40 checks passing.

> Note: the app request builds on `PLAN.md` in the repository root, which is the binding technical specification.

## Packaging

Packaging is configured with **electron-builder** in `electron-builder.yml` and emits into `release/` (gitignored):

- **Linux** — AppImage + `.deb` (x64)
- **Windows** — NSIS installer + portable `.exe` (x64)
- **macOS** — `.dmg` (arm64 + x64)

Each target **must be built on its own OS**. sharp ships per-platform native prebuilt binaries (`@img/sharp-<os>-<arch>`) that npm only installs for the host OS, so cross-packaging produces an app whose native image code cannot load. The `release.yml` GitHub Actions workflow does this on a native-OS matrix and attaches the artifacts to a GitHub Release when a `v*` tag is pushed. Locally:

```bash
npm run dist:linux   # or dist:mac / dist:win on the matching OS
```

Those binaries are `dlopen`'d at runtime, so `asarUnpack` in `electron-builder.yml` keeps `node_modules/sharp/**` and `node_modules/@img/**` outside the asar. `font-list` is pure JS (it shells out to `fc-list` / PowerShell / VBS) and stays packed.

### macOS signing & notarization

Signing auto-discovers a Developer ID identity from the keychain. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to force an unsigned build (which also skips notarization). Notarization (`mac.notarize: true`) reads credentials from the environment and is skipped when they are absent:

| Variable | Purpose |
|---|---|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID certificate (`.p12` path or base64) and its password |
| `APPLE_ID` | Apple account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for the account |
| `APPLE_TEAM_ID` | Developer team ID |

The CI workflow passes these from repository secrets, so adding the secrets is all that is needed to produce signed + notarized mac builds.

> Linux `.deb` builds use the bundled `fpm`/Ruby toolchain, which requires `libcrypt.so.1` on the build host (present on Debian/Ubuntu; on Fedora install `libxcrypt-compat`). The AppImage target has no such dependency.

## Project layout

```
plan.md                    Binding technical specification & milestone plan
src/shared/ipc.ts          IPC channel map, DTO types, renderer-facing bridge type
src/main/                  Electron main process (window, dialogs, font-list, sharp)
src/preload/               Sandboxed preload bridge (contextBridge)
src/renderer/              Web UI (editor, live preview)
spike/spike.mjs            Feasibility spike test suite
scripts/make-icon.mjs      Generates build/icon.png (platform icon source)
electron.vite.config.mts   Build configuration
electron-builder.yml       Packaging configuration
.github/workflows/release.yml  Native-OS packaging matrix
```

## Status

- Milestone 1 (spike) — done
- Milestone 2 (scaffold) — done: secure split, typed IPC bridge, `list-fonts` live end-to-end
- Milestone 3 (core pipeline) — done: `open-image`, `get-frame-count`, `render-text-layer`, `save-image` IPC handlers implemented with sharp; native open/save dialogs; full-res composite encodes in the source format (JPEG 90%); multi-frame warning flow; preview rendered in the app
- Milestone 4 (interactive editor) — done: move (drag), rotate (Shift snaps to 15°), resize (4 corner handles scale font + wrap width), click-to-edit multi-row text, live preview; validation (non-blank, ≤100 Unicode code points, whitespace-only rejection); full-res text layer rendered on an offscreen canvas and composited at save time
- Milestone 5 (fonts & dialogs) — done: font picker with search filter, alphabetical grouping, and options previewed in their own typeface; font weight selector (100–900); family names sanitized (Linux `font-list` quotes) and quoted safely for canvas + CSS; save dialog enforces the source extension (native filter + `lockExtension` post-validate per `src/main/paths.ts`) with `-watermarked` default rename
- Milestone 6 (polish) — done: drag-and-drop open (`webUtils.getPathForFile` + `open-image` with an optional path), empty-state UX with an in-panel Open button, error states (unsupported format / decode failures surfaced in styled messages, editor controls disabled until an image is open, drop-over highlight), and EXIF handling (oriented dimensions reported so preview/output and the full-res text layer align; unsupported-formats rejected at open time)
- Milestone 7 (packaging) — done: electron-builder config for Linux (AppImage + deb), Windows (NSIS + portable) and macOS (dmg, sign/notarize via env), generated app icon, `dist`/`pack` scripts, and a native-OS GitHub Actions release matrix; sharp's native `@img` binaries are unpacked from the asar

## Out of scope (v1)

Image type conversion, watermark images/logos, frame-by-frame animation editing, batch processing, and any format outside the fixed set.