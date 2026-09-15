# Watermarker

A cross-platform desktop app that lets you open a local image, add a text watermark, position and style it in a live preview, and save a flattened copy in the original file format.

Built with **Electron + TypeScript + Vite** (`electron-vite`), targeting Windows, macOS, and Linux.

## Summary

- **Input/output formats (fixed set):** PNG, JPEG, WebP, TIFF, GIF. Anything else is rejected at open time.
- **Output type is locked:** the saved file always keeps the source format; the user cannot change it.
- **Animated GIF / multi-frame TIFF:** a warning is shown and the watermark is flattened into the first frame (result is single-frame).
- **Watermark:** any locally installed OS font (enumerated via `font-list`); up to 100 Unicode characters; multi-row via line breaks and/or word-wrap.
- **Preview matches output:** text is drawn in the renderer (Chromium/Skia), and EXIF orientation is honored via sharp `.rotate()`.

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

- The typed IPC contract lives in `src/shared/ipc.ts` and exposes exactly five whitelisted channels: `list-fonts`, `open-image`, `save-image`, `get-frame-count`, `render-text-layer`.
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

To run the tests:

```bash
npm run spike
```

This exercises all 5 formats against sharp (round-trip format/dimension preservation, the composite pipeline, first-frame flattening for animated GIF/multi-frame TIFF, EXIF `.rotate()` handling) and verifies `font-list` enumeration. Last run: 40/40 checks passing.

> Note: the app request builds on `PLAN.md` in the repository root, which is the binding technical specification.

## Project layout

```
plan.md                 Binding technical specification & milestone plan
src/shared/ipc.ts       IPC channel map, DTO types, renderer-facing bridge type
src/main/               Electron main process (window, dialogs, font-list, sharp)
src/preload/            Sandboxed preload bridge (contextBridge)
src/renderer/           Web UI (editor, live preview)
spike/spike.mjs         Feasibility spike test suite
electron.vite.config.mts  Build configuration
```

## Status

- Milestone 1 (spike) — done
- Milestone 2 (scaffold) — done: secure split, typed IPC bridge, `list-fonts` live end-to-end
- Milestone 3 (core pipeline) — done: `open-image`, `get-frame-count`, `render-text-layer`, `save-image` IPC handlers implemented with sharp; native open/save dialogs; full-res composite encodes in the source format (JPEG 90%); multi-frame warning flow; preview rendered in the app
- Milestones 4–7 — pending: editor (move/resize/rotate/multi-row text layer), fonts & dialogs polish, drag-and-drop + error states, packaging

## Out of scope (v1)

Image type conversion, watermark images/logos, frame-by-frame animation editing, batch processing, and any format outside the fixed set.