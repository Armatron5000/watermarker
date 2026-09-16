import type { OpenImageResult } from '../../shared/ipc'
import { Editor } from './editor'

const api = window.api
const statusEl = document.querySelector<HTMLSpanElement>('#bridge-status')
const btnOpen = document.querySelector<HTMLButtonElement>('#btn-open')!
const btnSave = document.querySelector<HTMLButtonElement>('#btn-save')!
const fontSelect = document.querySelector<HTMLSelectElement>('#font-select')!
const fontSizeInput = document.querySelector<HTMLInputElement>('#font-size')!
const opacitySlider = document.querySelector<HTMLInputElement>('#opacity-slider')!
const msgEl = document.querySelector<HTMLParagraphElement>('#status-msg')!
const multiFrameWarning = document.querySelector<HTMLDivElement>('#multi-frame-warning')!
const frameCountEl = document.querySelector<HTMLSpanElement>('#frame-count')!
const imageInfo = document.querySelector<HTMLDivElement>('#image-info')!
const infoName = document.querySelector<HTMLSpanElement>('#info-name')!
const infoDims = document.querySelector<HTMLSpanElement>('#info-dims')!
const infoFormat = document.querySelector<HTMLSpanElement>('#info-format')!
const previewArea = document.querySelector<HTMLDivElement>('#preview-area')!
const emptyHint = document.querySelector<HTMLParagraphElement>('#empty-hint')!

const editor = new Editor(previewArea)

let currentImage: OpenImageResult | null = null

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

async function loadImage(result: OpenImageResult): Promise<void> {
  currentImage = result
  await editor.loadImage(result)

  emptyHint.hidden = true

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
  if (!currentImage) return

  const v = editor.validateText(editor.text)
  if (!v.valid) {
    setMsg(v.error ?? 'Watermark text is required.')
    return
  }

  const textLayer = editor.renderFullResTextLayer()
  if (!textLayer) {
    setMsg('No text layer to save.')
    return
  }

  try {
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

  fontSelect.addEventListener('change', () => {
    editor.changeFont(fontSelect.value)
  })
  fontSizeInput.addEventListener('input', () => {
    editor.changeFontSize(Number(fontSizeInput.value))
  })
  opacitySlider.addEventListener('input', () => {
    editor.changeOpacity(Number(opacitySlider.value) / 100)
  })

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