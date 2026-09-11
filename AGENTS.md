# AGENTS.md

## State of the repo

Pre-implementation. The only artifact is `PLAN.md` — the binding tech spec for the app. No code, `package.json`, or dev tooling exists yet.

- Read `PLAN.md` before proposing or building anything; treat it as the contract.
- Electron (TypeScript proposed), shore-based architecture described in PLAN.md §3; targets Windows, macOS, Linux.

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

## Spike learnings (API gotchas that cost time)

- `sharp(input, { width, height, channels })` is wrong — must be wrapped: `{ raw: { width, height, channels } }`, else the buffer is treated as an encoded image and decode fails.
- `.toBuffer({ resolveWithObject: true })` resolves to `{ data, info }`; read `info.format/info.width/...`, not `data.format`.
- Single-frame output reports `info.pages === undefined` (not 1); normalize `pages ?? 1`. `metadata()`/`info` do not report `pageHeight` here.
- `font-list` v2 exports a named `getFonts`, not a default-callable.
- Lossy encoders (JPEG/WebP) smear DCT blocks across the watermark edge — pixels within ~1 block of the watermark may shift slightly; unavoidable, don't treat as a regression.