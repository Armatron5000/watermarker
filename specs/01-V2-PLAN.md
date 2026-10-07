# Watermarker — v2 Plan: Polish Round

Companion to `specs/00-INIT-PLAN.md` (the immutable v1 contract). `specs/` is the brain source of the project; documents are numbered by order of authority — this plan may refine v1 behavior but never overrides §1–§6 of `00-INIT-PLAN.md`.

**Intent:** no new features. v1 (Milestones 1–7) ships; this round hardens what exists — reliability, accessibility, developer health, and docs truthfulness. The format set, the text-only watermark model, the IPC surface, and the secure 3-tier split all stay exactly as specified in v1.

---

## 1. Reliability & robustness

### 1.1 Async operation states (high)

`handleOpen` / `handleSave` / `handleDroppedFile` are async but never disable their triggers (`src/renderer/src/main.ts:112-121, 173-203`).

- Disable `#btn-open`, `#btn-open-empty`, `#btn-save` for the duration of the in-flight call; restore per the normal enable rules afterward.
- Show a busy indicator in the status message area (`Opening…` / `Saving…`).
- Re-entrancy guard so a double-click or a drop during an open cannot start a second `open-image` call.
- While saving, also block editor mutations (disable `#editor-controls`) so the text layer cannot change mid-save.

### 1.2 Unsaved-changes guard (high)

There is no dirty flag and no close guard (`src/renderer/src/editor.ts`, `src/main/index.ts`).

- Track a `dirty` flag in `Editor`: set on any text/font/position/opacity change, cleared on successful save and on image load.
- Reloading an image (open or drop) while dirty → confirm dialog: *"Discard unsaved watermark changes?"* (Discard / Cancel). Cancel aborts the load; the previous image and state stay intact.
- Window close / app quit while dirty → Electron `dialog.showMessageBox` from main (via a small `confirm-discard` path or `before-input-event`-free approach: renderer listens to a `beforeunload` that is only armed when dirty, and main intercepts `close`). Confirm discards, Cancel prevents close.
- Non-dirty close must never prompt.

### 1.3 Large-image & canvas limits (high)

`renderFullResTextLayer` allocates a source-sized canvas and a full-res `getImageData` (`src/renderer/src/editor.ts:160-187`); main reads the whole file into memory (`src/main/ipc.ts:120-125`). Browsers cap canvas dimensions (~32767 px/side) and unbounded allocations can OOM.

- Before allocating, check `width × height` against a documented cap (e.g. 8192×8192 ≈ 268 MP) and per-side canvas limit; on exceed, fail with a clear message: *"Image is too large to watermark (max 8192 × 8192)."* — never a raw `IndexSizeError`.
- Guard `getContext('2d')` against `null` (`editor.ts`), same message path.
- Preview path stays as-is (sharp already downscales to ≤1200px).

### 1.4 Filesystem & IPC error mapping (medium)

`readFile` / `writeFile` / sharp decode errors bubble as raw Node strings (`src/main/ipc.ts`); the renderer only strips Electron's IPC prefix (`src/renderer/src/main.ts:47-53`).

- Add a `friendlyFsError(err)` helper in main mapping `ENOENT`, `EACCES`/`EPERM`, `EISDIR`, `ENOSPC`, `EMFILE` to human sentences; apply at open and save boundaries.
- Decode failures on a valid extension (renamed/corrupt file) keep the current "decode failed" message — verify it stays understandable after the mapping change.
- `asMessage` in the renderer keeps the prefix strip as a backstop for anything unmapped.

---

## 2. Accessibility & input

### 2.1 Live regions & semantics (medium)

- `#status-msg` → `role="status"` + `aria-live="polite"`; error messages also `role="alert"` semantics (the class change is enough if the region is live).
- Preview `<img>` gets meaningful `alt` (file name, or empty + `aria-hidden` when decorative because the overlay carries the text).
- Font search gets an associated `<label>`/`aria-label`; report the filtered count (`12 of 166 fonts`) in a polite live region.
- The drop overlay gets visible text + `role="status"` so sighted-only feedback is announced.

### 2.2 Keyboard shortcuts (medium)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+O` | Open image |
| `Ctrl/Cmd+S` | Save |
| `Ctrl/Cmd+F` | Focus font search (only when an image is open) |
| `Esc` | Cancel drop overlay / dismiss current message |

- Shortcut handlers must respect the same busy/disabled state as the buttons (no save while a save is in flight).
- Never hijack keys while the contenteditable text box has focus except `Ctrl/Cmd+S`/`Ctrl/Cmd+O`.

### 2.3 Focus management (medium)

- On validation failure during save, move focus to the text box (`src/renderer/src/main.ts:176-180`).
- After an image loads, focus lands on the text box (or `#font-select` if the text box is empty) so keyboard users are not stranded on the empty-state button.
- Visible `:focus-visible` styles for the empty-state button, handles, and selects.

### 2.4 Undo/redo (medium)

A single-level undo for editor state mutations (text, font, size, weight, opacity, x/y, rotation, wrap width) — snapshot on each committed interaction (drag/rotate/resize end, blur, control change), `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`. Cap the stack (e.g. 50). Text typing coalesces per blur/edit session rather than per keystroke.

---

## 3. Editor & preview behavior

### 3.1 Container resize (medium)

`scaleOverlay` hardcodes `areaH = 500` and `this.previewArea.clientWidth || 800` and runs only on image load (`src/renderer/src/editor.ts:86-110`).

- Add a `ResizeObserver` on the preview area (plus `window.resize` fallback) that re-runs `scaleOverlay` and repositions the overlay; the text box must keep its display-relative position and scale.
- Revisit `.preview-area { max-height: 500px; overflow: hidden }` so the preview isn't clipped on short windows; the overlay must never extend beyond the visible area without scrolling/clamping.

### 3.2 Numeric feedback (low)

- Show the current rotation angle while rotating (and after), snapped to 15° when Shift is held — currently rotation state is invisible (`editor.ts` rotate handler).
- Show the current font size while resizing (it is derived, not displayed).

### 3.3 Edge-case interaction guards (low)

- Reject drops of directories/0-byte files client-side with a clear message instead of relying on main's decode error.
- `Escape` cancels an in-progress drag/rotate/resize (no partial commit).
- Rapid successive drops: last one wins; the earlier in-flight open is abandoned (its result must not overwrite a newer load — sequence-token the open path).

---

## 4. Developer health

### 4.1 Unit tests (high)

No test infrastructure exists; `spike/spike.mjs` is an integration script only.

- Add **vitest** and cover the pure, main-side logic first where it pays off: `src/main/paths.ts` (extension lock helpers — `extensionFor`, `withDefaultExtension`, `lockExtension`, `outputFormat`), the format/extension allow-lists in `src/shared/ipc.ts`, and the renderer's pure helpers (`cleanFontName`, `cssFontFamily`, validation rules: blank/whitespace/100-code-point/multi-line).
- Keep sharp-heavy checks in the evergreen spike (`npm run spike`, 40/40) — no new native test surface.
- Scripts: `npm test` (vitest run), keep `npm run spike` separate.

### 4.2 Linting (medium)

No ESLint/Prettier. Add a minimal, non-controversial set: `@typescript-eslint` recommended-type-checked for main/preload/renderer, plus a single Prettier config so formatting is not bikeshedded. Wire as `npm run lint` (+ `npm run lint:fix`). Must pass on the existing tree with no suppressions sprayed around.

### 4.3 CI quality gate (high)

`.github/workflows/release.yml` runs only on `v*` tags / manual dispatch; there is no PR or push CI.

- New `.github/workflows/ci.yml` on `pull_request` + `push: main`: `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run spike` → `npm run build` (Linux runner; sharp + font-list work headless, no display needed for these steps).
- `release.yml` gains a `needs: ci`-style gate: at minimum run typecheck+test before packaging on each matrix OS.

### 4.4 Scripts & config hygiene (low)

- Add `npm run check` = typecheck + lint + test + spike, the one command a contributor runs.
- Confirm `tsconfig` strict flags stay on (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` already are).

---

## 5. Documentation truthfulness

- README: verify every claim against the code after this round (scripts table gains `test`/`lint`/`check`; shortcuts table; new error/limits messages; the "Note" about `specs/` stays).
- AGENTS.md: record new gotchas this round discovers (dirty-flag/close-guard interplay, ResizeObserver + overlay scale, canvas cap rationale) and update the Verification section with the polish-round results.
- `specs/00-INIT-PLAN.md` remains byte-for-byte the v1 contract — if this round changes a behavior it specifies, add a footnote here under a "Deltas from v1" section rather than editing it.

---

## 6. Out of scope (this round)

Unchanged from `00-INIT-PLAN.md` §6 and explicitly deferred: image/logo watermarks, batch processing, extra formats (BMP/AVIF/HEIC), frame-by-frame animation editing, format conversion on save, auto-update/telemetry, i18n, theme switching, recent-files list, settings persistence.

---

## 7. Milestones

1. **Safety net** — vitest + pure-function tests for `paths.ts`/`ipc.ts`/validation; ESLint; `ci.yml` running typecheck/lint/test/spike on PRs. *(Everything else builds on this.)*
2. **Async & dirty state** — busy/disabled states, re-entrancy guards, dirty flag, discard confirmation on reload/close, save-sequence tokens.
3. **Limits & errors** — canvas/dimension cap with friendly message, `null` context guard, filesystem error mapping at open/save boundaries.
4. **A11y & keyboard** — live regions, labels, focus management, shortcut table, visible focus styles.
5. **Editor behavior** — ResizeObserver-driven overlay scaling, preview clipping fix, angle/size readouts, Esc-cancel interactions, single-level undo/redo.
6. **Docs & verification** — README/AGENTS sync, `check` script, full verification pass (below).

## 8. Verification

Each milestone lands green on: `npm run check` (typecheck + lint + test + spike) and `npm run build`.

Round-level sign-off:

- Unit tests cover every `paths.ts` helper and every validation rule (blank, whitespace-only, >100 code points, multi-line, exact 100).
- Manual E2E on the dev OS: double-click open/save cannot double-fire; closing dirty prompts, closing clean does not; a 9000×9000 image shows the cap message instead of throwing; `EACCES` on save shows a sentence, not an `ENOENT: ...` dump; `Ctrl/Cmd+O`/`S` work outside the text box and are inert during a save.
- `npm run dist:linux` still produces a bootable AppImage/deb (packaging untouched, but re-checked after the dependency additions).
