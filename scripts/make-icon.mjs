// Generates build/icon.png (1024x1024) used by electron-builder for all
// platforms (Linux PNG, Windows .ico and macOS .icns are derived from it).
// Run with: npm run icon
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build', 'icon.png')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
  <g transform="rotate(-45 512 512)">
    <rect x="-220" y="424" width="1464" height="176" fill="#ffffff" opacity="0.10"/>
    <rect x="-220" y="432" width="1464" height="24" fill="#ffffff" opacity="0.18"/>
  </g>
  <path d="M240 300 L370 724 L512 420 L654 724 L784 300"
        fill="none" stroke="#ffffff" stroke-width="96"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

await mkdir(dirname(out), { recursive: true })
await sharp(Buffer.from(svg)).png().toFile(out)
console.log(`wrote ${out}`)
