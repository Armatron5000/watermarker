import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join as joinPath } from "node:path";
import sharp from "sharp";
import { getFonts } from "font-list";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = joinPath(__dirname, "out");
await mkdir(OUT, { recursive: true });

const hardFailure = (msg) => {
  console.error(`\nHARD FAILURE: ${msg}`);
  process.exit(1);
};

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
};

const SOURCE_W = 640;
const SOURCE_H = 480;

const gradientRaw = (w = SOURCE_W, h = SOURCE_H) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i + 0] = Math.round((x / w) * 255);
      buf[i + 1] = Math.round((y / h) * 255);
      buf[i + 2] = (x + y) % 256;
      buf[i + 3] = 255;
    }
  }
  return buf;
};

const flatRaw = (rgb, w = 320, h = 240) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    buf[o + 0] = rgb[0];
    buf[o + 1] = rgb[1];
    buf[o + 2] = rgb[2];
    buf[o + 3] = 255;
  }
  return buf;
};

const maxAbsDiffOutside = (a, b, w, h, ch, box) => {
  const pad = 48; // lossy encoders smear DCT blocks across the overlay edge
  let max = 0;
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = Math.floor(p / w);
    if (x >= box.x - pad && x < box.x + box.w + pad && y >= box.y - pad && y < box.y + box.h + pad) continue;
    for (let c = 0; c < ch; c++) {
      const d = Math.abs(a[p * ch + c] - b[p * ch + c]);
      if (d > max) max = d;
    }
  }
  return max;
};

const asRgba = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 4 };
};

const ENCODERS = {
  png: (s) => s.png(),
  jpeg: (s) => s.jpeg({ quality: 90 }),
  webp: (s) => s.webp(),
  gif: (s) => s.gif(),
  tiff: (s) => s.tiff(),
};

console.log("### SPIKE: Watermarker feasibility (Linux/" + process.platform + ")\n");

// ---------------------------------------------------------------------------
console.log("## 0. Environment\n");
check("sharp loads, libvips " + sharp.versions.vips + ", sharp " + sharp.versions.sharp, true);
for (const fmt of Object.keys(ENCODERS)) {
  const fmtMeta = sharp.format[fmt];
  check(`sharp can write ${fmt}`, Boolean(fmtMeta?.output?.buffer), `input=${fmtMeta?.input?.buffer}`);
}
try {
  await sharp(Buffer.from("definitely not an image at all, just text bytes")).toBuffer();
  check("garbage input rejected at decode", false);
} catch {
  check("garbage input rejected at decode", true, "throws as expected");
}

// ---------------------------------------------------------------------------
console.log("\n## 1. Format round-trips preserving type + composite pipeline (specs/00-INIT-PLAN §3.2)\n");
const sourceRaw = gradientRaw(SOURCE_W, SOURCE_H);
const sourceRawo = { raw: { width: SOURCE_W, height: SOURCE_H, channels: 4 } };

const sourceBufs = {};
for (const [fmt, enc] of Object.entries(ENCODERS)) {
  sourceBufs[fmt] = await enc(sharp(sourceRaw, sourceRawo)).toBuffer();
  await writeFile(joinPath(OUT, `source.${fmt}`), sourceBufs[fmt]);
}

const OVL_W = 240;
const OVL_H = 90;
const OVL_X = 60;
const OVL_Y = 40;
const ovlRaw = Buffer.alloc(OVL_W * OVL_H * 4);
for (let y = 0; y < OVL_H; y++) {
  for (let x = 0; x < OVL_W; x++) {
    const i = (y * OVL_W + x) * 4;
    const transparent = y < OVL_H / 2;
    ovlRaw[i + 0] = transparent ? 0 : 255;
    ovlRaw[i + 1] = transparent ? 0 : 0;
    ovlRaw[i + 2] = transparent ? 0 : 0;
    ovlRaw[i + 3] = transparent ? 0 : 200;
  }
}
const overlayPng = await sharp(ovlRaw, {
  raw: { width: OVL_W, height: OVL_H, channels: 4 },
})
  .png()
  .toBuffer();

const box = { x: OVL_X, y: OVL_Y, w: OVL_W, h: OVL_H };
for (const fmt of Object.keys(ENCODERS)) {
  const { info: wmInfo, data: wmBuf } = await ENCODERS[fmt](
    sharp(sourceBufs[fmt]).rotate().composite([{ input: overlayPng, left: OVL_X, top: OVL_Y, blend: "over" }])
  ).toBuffer({ resolveWithObject: true });
  const refBuf = fmt !== "png" ? await ENCODERS[fmt](sharp(sourceBufs[fmt]).rotate()).toBuffer() : sourceBufs[fmt];

  const wmRgba = await asRgba(wmBuf);
  const refRgba = await asRgba(fmt === "gif" ? sourceBufs[fmt] : refBuf);

  const CHECK_TOL = { png: 0, jpeg: 40, webp: 40, gif: 48, tiff: 40 }[fmt];
  check(`${fmt}: output format === source (${fmt})`, wmInfo.format === fmt, `got ${wmInfo.format}`);
  check(`${fmt}: dimensions preserved (${SOURCE_W}x${SOURCE_H})`, wmInfo.width === SOURCE_W && wmInfo.height === SOURCE_H);
  check(
    `${fmt}: pixels far outside watermark unchanged vs plain re-encode`,
    maxAbsDiffOutside(refRgba.data, wmRgba.data, SOURCE_W, SOURCE_H, 4, box) <= CHECK_TOL,
    `max diff ${maxAbsDiffOutside(refRgba.data, wmRgba.data, SOURCE_W, SOURCE_H, 4, box)} (tol ${CHECK_TOL})`
  );

  const at = (data, x, y) => {
    const i = (y * SOURCE_W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const top = at(wmRgba.data, OVL_X + 8, OVL_Y + 8); // transparent overlay half -> unchanged
  const refTop = at(refRgba.data, OVL_X + 8, OVL_Y + 8);
  const bottom = at(wmRgba.data, OVL_X + 8, OVL_Y + OVL_H - 8); // red overlay half -> tinted red
  const refBottom = at(refRgba.data, OVL_X + 8, OVL_Y + OVL_H - 8);
  const topOk = Math.max(...top.map((v, c) => Math.abs(v - refTop[c]))) <= (fmt === "gif" ? 24 : 8);
  const bottomOk = bottom[0] - refBottom[0] > 60 && Math.max(...bottom.map((v, c) => Math.abs(v - refBottom[c]))) > 60;
  check(
    `${fmt}: watermark composited (transparent half passthrough, red half tints source)`,
    topOk && bottomOk,
    `top ${top}~${refTop} / bottom ${bottom}~${refBottom}`
  );
}

await writeFile(joinPath(OUT, "mismatched-extension.png"), sourceBufs.webp);
const byContent = await sharp(joinPath(OUT, "mismatched-extension.png")).metadata();
check("file type determined by content, not extension", byContent.format === "webp", `named .png but read as ${byContent.format}`);

// ---------------------------------------------------------------------------
console.log("\n## 2. Animated GIF + multi-frame TIFF: first-frame flatten (specs/00-INIT-PLAN §1.2)\n");
const frames = [flatRaw([255, 0, 0]), flatRaw([0, 255, 0]), flatRaw([0, 0, 255])];
const framePngs = await Promise.all(
  frames.map((b) => sharp(b, { raw: { width: 320, height: 240, channels: 4 } }).png().toBuffer())
);

const gifBuf = await sharp(framePngs, { join: { animated: true } }).gif().toBuffer();
await writeFile(joinPath(OUT, "animated.gif"), gifBuf);
const gifMeta = await sharp(gifBuf).metadata();
check("animated GIF created (3 frames)", gifMeta.pages === 3 && gifMeta.format === "gif", `pages=${gifMeta.pages}, format=${gifMeta.format}`);

const tifBuf = await sharp(framePngs, { join: { animated: true } }).tiff().toBuffer();
await writeFile(joinPath(OUT, "multipage.tiff"), tifBuf);
const tifMeta = await sharp(tifBuf).metadata();
check("multi-frame TIFF created (3 pages)", tifMeta.pages === 3 && tifMeta.format === "tiff", `pages=${tifMeta.pages}, format=${tifMeta.format}`);

const markerPng = await sharp(flatRaw([200, 200, 0], 60, 60), { raw: { width: 60, height: 60, channels: 4 } }).png().toBuffer();

for (const [name, buf] of [["GIF", gifBuf], ["TIFF", tifBuf]]) {
  const { info, data } = await ENCODERS[name.toLowerCase()](
    sharp(buf, { page: 0 }).composite([{ input: markerPng, left: 8, top: 8, blend: "over" }])
  ).toBuffer({ resolveWithObject: true });
  const { pages: readPages, format: readFormat } = await sharp(data).metadata();
  const framesOut = readPages === undefined ? 1 : readPages;
  check(
    `${name}: first-frame flatten -> single-frame ${name.toLowerCase()} with watermark`,
    info.format === name.toLowerCase() &&
      framesOut === 1 &&
      info.width === 320 &&
      info.height === 240,
    `format=${info.format}, framesOut=${framesOut}, ${info.width}x${info.height}, ${data.length}B`
  );
}

check(
  "GIF frame-count detectability for warning flow (specs/00-INIT-PLAN §1.2)",
  gifMeta.pages === 3,
  `metadata().pages=${gifMeta.pages} usable for "N frames" warning`
);

// ---------------------------------------------------------------------------
console.log("\n## 3. EXIF orientation: preview (auto-orient) vs output (.rotate()) (specs/00-INIT-PLAN §3.4)\n");
const exifJpeg = await sharp(sourceRaw, sourceRawo).jpeg().withMetadata({ orientation: 6 }).toBuffer();
const exifMeta = await sharp(exifJpeg).metadata();
check(
  "fixture JPEG has EXIF orientation 6",
  exifMeta.orientation === 6,
  `orientation=${exifMeta.orientation}, autoOrient dims=${exifMeta.autoOrient.width}x${exifMeta.autoOrient.height}`
);
const viaRotate = await sharp(exifJpeg).rotate().raw().toBuffer({ resolveWithObject: true });
const viaAutoOrient = await sharp(exifJpeg).autoOrient().raw().toBuffer({ resolveWithObject: true });
check(
  ".rotate() matches .autoOrient() (browser-style orientation) bytes",
  viaRotate.data.equals(viaAutoOrient.data) && viaRotate.info.width === SOURCE_H && viaRotate.info.height === SOURCE_W,
  `dims=${viaRotate.info.width}x${viaRotate.info.height}`
);
const { info: rotatedOutInfo, data: rotatedOut } = await sharp(exifJpeg)
  .rotate()
  .composite([{ input: overlayPng, left: 10, top: 10, blend: "over" }])
  .jpeg()
  .toBuffer({ resolveWithObject: true });
const rotatedMeta = await sharp(rotatedOut).metadata();
check(
  "pipeline .rotate() then composite then encode strips stale orientation tag",
  rotatedOutInfo.format === "jpeg" && (rotatedMeta.orientation === undefined || rotatedMeta.orientation === 1),
  `format=${rotatedOutInfo.format}, orientation=${rotatedMeta.orientation}`
);

// ---------------------------------------------------------------------------
console.log("\n## 4. font-list enumeration (specs/00-INIT-PLAN §2.3)\n");
let fonts = [];
try {
  fonts = await getFonts();
} catch (e) {
  hardFailure(`font-list threw: ${e.message}`);
}
const unique = new Set(fonts.map((f) => f.toLowerCase()));
check("font-list returns a non-empty list", fonts.length > 0, `${fonts.length} fonts, ${unique.size} unique`);
const allStrings = fonts.every((f) => typeof f === "string" && f.trim().length > 0);
check("entries are non-empty family names", allStrings);
check("sample entries", true, fonts.slice(0, 8).join(" | "));
const minimalFamilies = ["DejaVu Sans", "Liberation", "Noto", "Arial", "Sans"].filter((n) =>
  fonts.some((f) => f.toLowerCase().includes(n.toLowerCase()))
);
check("recognizable system families present", minimalFamilies.length > 0, minimalFamilies.join(", "));

// ---------------------------------------------------------------------------
const summary = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\n=== RESULT: ${summary}/${checks.length} checks passed, ${failed.length} failed ===`);
if (failed.length) {
  console.log("Failed:");
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}