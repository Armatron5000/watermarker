# AGENTS.md

## State of the repo

Milestones 1 (spike), 2 (scaffold), and 3 (core pipeline) are complete. `PLAN.md` remains the binding contract; read it before building anything.

- Electron 44 + TypeScript + Vite (`electron-vite`), secure 3-tier split: `src/main` (dialogs, font-list, all sharp work) ↔ `src/preload` (typed bridge) ↔ `src/renderer` (UI). `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Targets Windows, macOS, Linux.
- The typed IPC contract lives in `src/shared/ipc.ts` (`IpcChannelMap` maps each whitelisted channel to `request`/`response`; `IpcBridge` is the renderer-facing surface). Exactly the five channels from PLAN §3.5: `list-fonts`, `open-image`, `save-image`, `get-frame-count`, `render-text-layer`. **All five are implemented** in `src/main/ipc.ts`:
  - `list-fonts` — real `font-list` enumeration.
  - `open-image` — native open dialog (5-format filter) → sharp decode → PNG preview data URL (≤1200px, EXIF `.rotate()`) + { path, name, format, width, height, frameCount }.
  - `get-frame-count` — returns `metadata().pages ?? 1`.
  - `render-text-layer` — composites a raw RGBA text-layer buffer over the source at (x, y) and returns a PNG preview data URL (the "live preview" path).
  - `save-image` — native save dialog with extension locked to source format → sharp composite → encode in the **source** format (JPEG 90%) → write to disk.
  - The composite pipeline is shared: `compositeTextLayer(sourcePath, textLayer, x, y)` in `src/main/ipc.ts`.
- Milestone 4 is next: the interactive editor (move/resize/rotate/multi-row text layer) and validation (non-blank, ≤100 Unicode code points, whitespace-only rejection). The renderer currently renders a **placeholder** full-res watermark via `renderFullResTextLayer()` in `src/renderer/src/main.ts` (centered, font from the dropdown, `x/y = 0`); the interactive DOM overlay replaces that in milestone 4.
- Commands: `npm run dev` (HMR dev), `npm run build` (typecheck + electron-vite build into `out/`), `npm run start` (preview the built app), `npm run typecheck`, `npm run spike`.
- Build gotcha: sandboxed preloads are CJS-only, so package.json deliberately has **no** `"type": "module"` (electron-vite would otherwise emit a `.mjs` preload that cannot load sandboxed). The config file is `electron.vite.config.mts` so it still loads as ESM.
- CSP is set via meta tag in `src/renderer/index.html` (dev HMR needs the `ws://localhost:*` connect-src allowance; `img-src` allows `data:`/`blob:` for previews).

## Non-negotiable spec constraints (easy to violate)

- Supported formats are **exactly** PNG, JPEG, WebP, TIFF, GIF. Reject everything else at open time.
- Output file type must **always** equal the source type; end user cannot change it; save dialog extension is locked.
- Animated GIF / multi-frame TIFF → warn, then flatten the watermark into the first frame; result is single-frame.
- Watermark text: non-blank, ≤100 Unicode characters (code-point length), supports multiple rows.
- Fonts: any locally installed OS font, enumerated via `font-list`. Text must be drawn in the renderer canvas (Skia), not sharp/Pango, so preview matches output.
- Preview must match final output (honor EXIF orientation with sharp `.rotate()`).

## Architecture notes

- Sanitized, secure 3-tier split: renderer (UI/editor) ↔ preload (typed IPC bridge) ↔ main (dialogs, `font-list`, all sharp work). `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- No CSS tricks beyond the editor; adopt the renderer text-layer → transparent PNG → sharp `.composite()` pipeline from PLAN.md §3.2.

## Verification

Spike done and passing (`npm run spike`, evergreen script at `spike/spike.mjs`). Verified on Linux (sharp 0.35.4, libvips 8.18.6), 40/40 checks:

- All 5 formats (PNG, JPEG, WebP, TIFF, GIF) write via sharp; round-trip preserves output format + dimensions; `composite({ blend: 'over' })` pipeline works per PLAN.md §3.2.
- Animated GIF (3 frames) and multi-frame TIFF preview/save flow: `metadata().pages > 1` detects multi-frame; reading with `{ page: 0 }` flattens to a single-frame output of the same format.
- EXIF: `metadata().orientation` reports the tag; `.rotate()` bytes equal `.autoOrient()` (what the browser preview shows); stale orientation tag stripped on save.
- `font-list` works: 170 families enumerated on the dev OS.

Scaffold verified (`npm run typecheck`, `npm run build`, live launch against the dev OS display): the built and dev apps both boot; renderer exposes `window.api` with exactly the 5 bridge methods; `listFonts()` resolves 170 families from main; `nodeIntegration` false; sandboxed renderer (`--enable-sandbox`). CSP warning cleared with the index.html meta tag.

Milestone 3 (core pipeline) verified (`npm run typecheck`, `npm run build`, focused sharp pipeline checks, live boot): preview generation (`.rotate()` → `.resize(1200, withoutEnlargement)` → `.png()`) produces a PNG data URL for all 5 formats including TIFF/WebP that Chromium won't always decode natively; `compositeTextLayer` composites a raw RGBA buffer (`raw: { channels: 4 }`, per spike learning #1) at (x, y) with EXIF `.rotate()`; save re-encodes in the source format via the same pipeline for all 5 formats preserving format + dimensions (JPEG at quality 90). 25/25 focused checks + 40/40 spike + clean build. App boots without crash (Electron's sharp-on-Linux binary warning is informational; sharp still loads and runs in the main process).

## Spike learnings (API gotchas that cost time)

- `sharp(input, { width, height, channels })` is wrong — must be wrapped: `{ raw: { width, height, channels } }`, else the buffer is treated as an encoded image and decode fails.
- `.toBuffer({ resolveWithObject: true })` resolves to `{ data, info }`; read `info.format/info.width/...`, not `data.format`.
- Single-frame output reports `info.pages === undefined` (not 1); normalize `pages ?? 1`. `metadata()`/`info` do not report `pageHeight` here.
- `font-list` v2 exports a named `getFonts`, not a default-callable.
- Lossy encoders (JPEG/WebP) smear DCT blocks across the watermark edge — pixels within ~1 block of the watermark may shift slightly; unavoidable, don't treat as a regression.