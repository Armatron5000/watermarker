# Watermarker — Technical Specification & Implementation Plan

A simple cross-platform desktop app that lets a user select a local image, apply a user-authored text watermark, interactively position/style it in a live preview, and save a flattened copy in the original file format.

Tech stack: **Electron** (main process in Node + secure preload bridge + web renderer).

---

## 1. Scope

### 1.1 Supported input / output formats (fixed set)

| Format | Preview | Decode (sharp read) | Encode (sharp write) | Notes |
|---|---|---|---|---|
| PNG | Chromium `<img>`/canvas | yes | yes | Alpha supported |
| JPEG | yes | yes | yes | Quality preserved at 90% by default |
| WebP | yes | yes | yes | |
| TIFF | no native preview | yes | yes | Multi-frame: see §1.2 |
| GIF | first frame | yes | yes | Animated: see §1.2 |

- **Read** (input): PNG, JPEG, WebP, TIFF, GIF. Anything else is rejected at open time with a clear message.
- **Write** (output): always the same format as the source. The user **cannot** change the type; the save dialog extension is locked to the source format.
- BMP, HEIC/AVIF, SVG and all other formats are **out of scope** for this first version.

### 1.2 Multi-frame policy (GIF / TIFF)

- Animated/multi-frame GIF and multi-frame TIFF are **not** edited frame-by-frame.
- When the user opens one, show a warning banner (repeated at save time):

  > "This file has N frames. The watermark will be applied to the first frame only; the result will not be animated."

- On save, the decoder is pinned to the **first frame**, the watermark is composited onto it, and the file is written as a single-frame image of the same format.
- For completeness, export the "Save before proceeding" option in a confirm dialog.

---

## 2. Feature requirements

### 2.1 Image selection
- User picks an image via a native file dialog (or drag-and-drop onto the window).
- Filter restricts to the five supported extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.tif`, `.tiff`, `.gif`.
- Selected image is loaded and displayed in the preview panel.

### 2.2 Watermark text
- Any non-blank, non-null text, **up to 100 Unicode characters** (validated by code-point length, not bytes).
- Whitespace-only input is rejected.
- Text can be **split into multiple rows**: the user may press Enter for explicit line breaks and/or enable word-wrap to a chosen width.
- No other text sources (e.g., file-based watermarks) in scope.

### 2.3 Font selection
- User picks any font installed on the **local OS** of the running machine.
- Fonts are enumerated via the `font-list` npm module:
  - Windows: registry / system; macOS: system font collection; Linux: fontconfig.
- The editor renders text using Chromium/Skia with that family name. If a family is missing at render time it falls back gracefully with a warning.

### 2.4 Preview panel (interactive editor)
The preview shows the source image with the watermark overlaid (e.g., 50% opacity) and lets the user manipulate the text layer:

- **Move** — drag with pointer.
- **Resize** — corner/edge handles (scales the text box).
- **Rotate** — a dedicated rotate handle.
- **Multi-row** — explicit line breaks via Enter and/or auto wrap at a box width.
- The text object can be repositioned freely over (and partly outside) the canvas bounds.

Interaction model: a DOM overlay layer (absolutely positioned text with CSS `transform`) for editing, mirrored into a canvas for the checks described in §3.3.

### 2.5 Save
- User chooses the output directory and renames the file via `dialog.showSaveDialog`.
- Default filename = original basename + `-watermarked`.
- **Extension is locked** to the source format; the user cannot change the file type.
- Non-blank, non-null filename required; validation error otherwise.
- On save the app renders a **full-resolution** flattened copy (see §3) and writes it to the chosen path; overwrite confirmation is handled by the native dialog.

---

## 3. Architecture

### 3.1 Process model

```
Renderer (web UI)                    Main process (Node)
────────────────────                 ────────────────────
Font picker, editor canvas   IPC →   font-list (enumerate local fonts)
File open / save dialogs      ← IPC   dialog.*
Preview / interaction                 sharp (decode, composite, encode)
```

- **Renderer**: UI, live preview, interactive editing, and the offscreen text-layer rendering.
- **Preload**: typed IPC bridge. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Only whitelisted channels are exposed.
- **Main**: file dialogs, font enumeration, and **all** image decode/composite/encode via sharp.

### 3.2 Pipeline (save time)

1. Read source file buffer (main).
2. **Text layer**: renderer draws the watermark (font, size, rotation, line wrapping, opacity) onto an offscreen `<canvas>` sized to the full-resolution image, exports as a transparent PNG buffer.
3. **Composite** (main, sharp):
   `sharp(sourceBuffer)` → `.rotate()` (honor EXIF orientation) → `.composite([{ input: textLayerPng, blend: 'over', gravity/topLeft as positioned }])` → encode to the **source format**.
4. **Save** to the chosen path with the source's extension.

### 3.3 Fonts: why text is drawn in the renderer

Chromium/Skia (the renderer canvas) renders text using the same OS font stack the user sees in the picker, so **preview font rendering is pixel-identical to the final output**. Sharp's own text pipeline (Pango/fontconfig) is avoided entirely — no Linux `fontconfig`/`pango` dependency, no cross-OS font fallback surprises. Sharp only composites a pre-rendered text PNG over the base image.

### 3.4 Fidelity & metadata

- **EXIF orientation**: browser decode auto-orients; force the same orientation in sharp (`.rotate()`) so preview and output agree.
- **Metadata**: EXIF is stripped by the canvas-text pipeline only when re-encoded; decide and document: keep sharp's metadata preservation for core fields (orientation handled manually), document that some metadata may not be preserved.
- **JPEG quality**: 90% default.
- **Colorspace**: accept minor ICC/colorspace differences between browser preview and sharp encode output; document as acceptable tolerance.

### 3.5 Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- IPC surface limited to: `list-fonts`, `open-image`, `save-image`, `get-frame-count`, `render-text-layer`.

---

## 4. Feasibility notes & risks

| Risk | Impact | Mitigation |
|---|---|---|
| sharp native module packaging on 3 OSes | Medium | electron-builder handles rebuild per platform; verify in spike |
| TIFF/WebP preview in Chromium (`<img>` decode may fail for some TIFFs) | Low | preview via a sharp-decoded PNG data-buffer fallback |
| Animated GIF first-frame behavior | Low | explicit warning flow (§1.2) |
| Large images exceed canvas limits | Low | cap interactive canvas; sharp composites at full resolution |
| EXIF/ICC fidelity differences | Low | consistent `.rotate()`; documented tolerance |
| macOS distribution | Low | code-signing/notarization handled at packaging milestone |
| `font-list` coverage on Linux | Medium | fontconfig required; verify + fallback list |

**Upsides of Electron here**: familiar web stack for the editor UX; single codebase across Win/mac/Linux; Chromium text rendering = pixel-accurate fonts everywhere.

**Downsides**: ~150MB bundle and higher RAM; the format-preservation rule requires a native library (sharp), which is the main packaging cost.

**Rejected alternatives** (documented rationale):
- *Tauri*: far smaller binaries, same UI — but needs Rust for codecs/fonts and depends on each OS's system webview (WebView2/WebKitGTK) → more variance, new language.
- *Flutter/Kotlin/Qt native*: best raw coverage but abandons the web stack.
- *PWA*: cannot reliably enumerate local fonts or save to an arbitrary directory → excluded by requirements.

---

## 5. Implementation plan (milestones)

1. **Spike** — scaffold repo; verify sharp round-trips all 5 formats preserving format + first-frame GIF flattening; verify `font-list` on the dev OS.
2. **Scaffold** — Electron + TypeScript + Vite, secure main/preload split, IPC types.
3. **Core pipeline** — open-image → sharp decode → preview render; render-text-layer → sharp composite → save-as-original-format; multi-frame warning flow.
4. **Editor** — move/resize/rotate/multi-row text layer with live preview; validation (non-blank, ≤100 chars, whitespace-only rejection, extension lock).
5. **Fonts & dialogs** — `font-list` enumeration, font picker, save dialog with locked extension and default rename.
6. **Polish** — drag-and-drop open, empty-state UX, error states, EXIF handling.
7. **Packaging** — electron-builder for Windows, macOS (signing/notarization), Linux.

---

## 6. Out of scope (explicitly)

- Image type conversion / format change on save.
- Watermark images/logos (text-only for v1).
- Multi-frame animation editing beyond the first-frame flatten policy.
- Batch processing of multiple files.
- BMP, HEIC/AVIF, SVG, and other formats not in the fixed set.