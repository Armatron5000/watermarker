import type { OpenImageResult } from '../../shared/ipc'

const api = window.api
const statusEl = document.querySelector<HTMLSpanElement>('#bridge-status')
const btnOpen = document.querySelector<HTMLButtonElement>('#btn-open')!
const btnSave = document.querySelector<HTMLButtonElement>('#btn-save')!
const fontSelect = document.querySelector<HTMLSelectElement>('#font-select')!
const msgEl = document.querySelector<HTMLParagraphElement>('#status-msg')!
const multiFrameWarning = document.querySelector<HTMLDivElement>('#multi-frame-warning')!
const frameCountEl = document.querySelector<HTMLSpanElement>('#frame-count')!
const imageInfo = document.querySelector<HTMLDivElement>('#image-info')!
const infoName = document.querySelector<HTMLSpanElement>('#info-name')!
const infoDims = document.querySelector<HTMLSpanElement>('#info-dims')!
const infoFormat = document.querySelector<HTMLSpanElement>('#info-format')!
const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!
const emptyHint = document.querySelector<HTMLParagraphElement>('#empty-hint')!

const ctx = canvas.getContext('2d')!

let currentImage: OpenImageResult | null = null
let previewImage: HTMLImageElement | null = null

function setStatus(text: string, className: string): void {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.className = `status ${className}`
}

function setMsg(text: string): void {
  msgEl.textContent = text
}

function clearMsg(): void {
  msgEl.textContent = ''
}

function redrawPreview(): void {
  if (!previewImage) return
  canvas.width = previewImage.naturalWidth
  canvas.height = previewImage.naturalHeight
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(previewImage, 0, 0)
  canvas.hidden = false
  emptyHint.hidden = true
}

async function loadImage(result: OpenImageResult): Promise<void> {
  currentImage = result

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to decode preview'))
    img.src = result.previewDataUrl
  })
  previewImage = img
  redrawPreview()

  infoName.textContent = result.name
  infoDims.textContent = `${result.width} × ${result.height}`
  infoFormat.textContent = result.format.toUpperCase()
  imageInfo.hidden = false

  const isMultiFrame = result.frameCount > 1
  multiFrameWarning.hidden = !isMultiFrame
  frameCountEl.textContent = String(result.frameCount)

  btnSave.disabled = false
}

async function handleOpen(): Promise<void> {
  try {
    const result = await api.openImage()
    if (!result) return
    await loadImage(result)
    clearMsg()
  } catch (err) {
    setMsg(`Open failed: ${String(err)}`)
  }
}

async function handleSave(): Promise<void> {
  if (!currentImage || !previewImage) return

  try {
    const textLayer = renderFullResTextLayer(currentImage.width, currentImage.height)
    const result = await api.saveImage({
      sourcePath: currentImage.path,
      format: currentImage.format,
      defaultName: currentImage.name.replace(/\.[^.]+$/, '-watermarked'),
      textLayer,
      x: 0,
      y: 0,
    })
    if (result) {
      setMsg(`Saved to ${result.savedPath}`)
    }
  } catch (err) {
    setMsg(`Save failed: ${String(err)}`)
  }
}

function renderFullResTextLayer(width: number, height: number) {
  const offscreen = document.createElement('canvas')
  offscreen.width = width
  offscreen.height = height
  const offCtx = offscreen.getContext('2d')!
  offCtx.clearRect(0, 0, width, height)
  offCtx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  offCtx.font = `${Math.max(24, Math.round(width / 20))}px ${fontSelect.value || 'sans-serif'}`
  offCtx.textAlign = 'center'
  offCtx.textBaseline = 'middle'
  offCtx.fillText('Watermark', width / 2, height / 2)
  const imageData = offCtx.getImageData(0, 0, width, height)
  return { data: new Uint8Array(imageData.data.buffer), width, height }
}

async function boot(): Promise<void> {
  if (!api) {
    setStatus('bridge unavailable', 'status-error')
    setMsg('window.api was not exposed by the preload script.')
    return
  }

  setStatus('bridge connected', 'status-ok')

  btnOpen.disabled = false
  btnOpen.addEventListener('click', handleOpen)
  btnSave.addEventListener('click', handleSave)

  try {
    const fonts = await api.listFonts()
    for (const font of fonts) {
      const option = document.createElement('option')
      option.value = font
      option.textContent = font
      fontSelect.appendChild(option)
    }
    fontSelect.disabled = false
  } catch (err) {
    setMsg(`Font enumeration failed: ${String(err)}`)
  }
}

void boot()
