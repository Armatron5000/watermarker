import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { getFonts } from 'font-list'
import type { ImageFormat, IpcChannelMap } from '../shared/ipc'
import { extensionFor, lockExtension, withDefaultExtension } from './paths'

function registerChannel<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    request: IpcChannelMap[K]['request']
  ) => IpcChannelMap[K]['response'] | Promise<IpcChannelMap[K]['response']>
): void {
  ipcMain.handle(channel, (_event, request: IpcChannelMap[K]['request']) => handler(request))
}

const IMAGE_FILTERS: Electron.FileFilter[] = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif'],
  },
]

function makePreview(srcPath: string): Promise<string> {
  return sharp(srcPath)
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .png()
    .toBuffer()
    .then((buf) => `data:image/png;base64,${buf.toString('base64')}`)
}

async function getImageMeta(srcPath: string) {
  const meta = await sharp(srcPath).metadata()
  const format = (meta.format ?? 'png') as ImageFormat
  return {
    format,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    pages: meta.pages ?? 1,
  }
}

async function compositeTextLayer(
  sourcePath: string,
  textLayer: IpcChannelMap['render-text-layer']['request']['textLayer'],
  x: number,
  y: number
) {
  const src = await readFile(sourcePath)
  const input = Buffer.from(textLayer.data.buffer, textLayer.data.byteOffset, textLayer.data.byteLength)

  return sharp(src)
    .rotate()
    .composite([
      {
        input,
        raw: { width: textLayer.width, height: textLayer.height, channels: 4 },
        blend: 'over',
        left: Math.round(x),
        top: Math.round(y),
      },
    ])
}

export function registerIpcHandlers(): void {
  registerChannel('list-fonts', async () => getFonts())

  registerChannel('open-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const meta = await getImageMeta(filePath)
    const previewDataUrl = await makePreview(filePath)
    const frameCount = meta.pages

    return {
      path: filePath,
      name: basename(filePath),
      format: meta.format,
      width: meta.width,
      height: meta.height,
      frameCount,
      previewDataUrl,
    }
  })

  registerChannel('get-frame-count', async (req) => {
    const meta = await getImageMeta(req.path)
    return meta.pages
  })

  registerChannel('render-text-layer', async (req) => {
    const composite = await compositeTextLayer(req.sourcePath, req.textLayer, req.x, req.y)
    const meta = await getImageMeta(req.sourcePath)
    const result = await composite.png().toBuffer()

    return {
      format: meta.format,
      width: meta.width,
      height: meta.height,
      dataUrl: `data:image/png;base64,${result.toString('base64')}`,
    }
  })

  registerChannel('save-image', async (req) => {
    const meta = await getImageMeta(req.sourcePath)
    const ext = extensionFor(meta.format)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: withDefaultExtension(req.defaultName, ext),
      properties: ['showOverwriteConfirmation'],
      filters: [{ name: 'Image', extensions: [ext] }],
    })
    if (!filePath) return null

    const finalPath = lockExtension(filePath, meta.format)

    const composite = await compositeTextLayer(req.sourcePath, req.textLayer, req.x, req.y)

    const formatHandlers: Record<ImageFormat, () => ReturnType<typeof sharp>> = {
      png: () => composite.png(),
      jpeg: () => composite.jpeg({ quality: 90 }),
      webp: () => composite.webp(),
      tiff: () => composite.tiff(),
      gif: () => composite.gif(),
    }

    const output = await formatHandlers[meta.format]().toBuffer()
    await writeFile(finalPath, output)

    return { savedPath: finalPath }
  })
}
