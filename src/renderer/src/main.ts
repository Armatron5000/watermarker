import type { OpenImageResult } from '../../shared/ipc'
import { UNSUPPORTED_FORMAT_MESSAGE, isSupportedImagePath } from '../../shared/ipc'
import { cleanFontName, cssFontFamily } from './editor'
import { Editor } from './editor'

const api = window.api
const statusEl = document.querySelector<HTMLSpanElement>('#bridge-status')
const btnOpen = document.querySelector<HTMLButtonElement>('#btn-open')!
const btnSave = document.querySelector<HTMLButtonElement>('#btn-save')!
const btnOpenEmpty = document.querySelector<HTMLButtonElement>('#btn-open-empty')!
const fontSelect = document.querySelector<HTMLSelectElement>('#font-select')!
const fontSearch = document.querySelector<HTMLInputElement>('#font-search')!
const fontWeightSelect = document.querySelector<HTMLSelectElement>('#font-weight')!
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
const emptyHint = document.querySelector<HTMLDivElement>('#empty-hint')!
const editorControls = document.querySelector<HTMLFieldSetElement>('#editor-controls')!

const editor = new Editor(previewArea)

let currentImage: OpenImageResult | null = null
let allFonts: string[] = []

function setStatus(text: string, className: string): void {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.className = `status ${className}`
}

function setMsg(text: string, kind: 'ok' | 'error' | '' = ''): void {
  msgEl.textContent = text
  msgEl.className = `note${kind === 'ok' ? ' msg-ok' : kind === 'error' ? ' msg-error' : ''}`
}

function clearMsg(): void {
  msgEl.textContent = ''
}

const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?(.*)$/s

function asMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const match = IPC_ERROR_PREFIX.exec(raw)
  return match && match[1] ? match[1] : raw
}

function populateFontSelect(fonts: string[]): void {
  const prev = fontSelect.value
  fontSelect.innerHTML = ''
  const groups = new Map<string, HTMLOptGroupElement>()
  for (const font of fonts) {
    const letter = (font[0]?.toUpperCase() ?? '#')
    let group = groups.get(letter)
    if (!group) {
      group = document.createElement('optgroup')
      group.label = letter
      groups.set(letter, group)
      fontSelect.appendChild(group)
    }
    const option = document.createElement('option')
    option.value = font
    option.textContent = font
    option.style.fontFamily = `${cssFontFamily(font)}, sans-serif`
    group.appendChild(option)
  }
  if (prev && fontSelect.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
    fontSelect.value = prev
  } else {
    const first = fontSelect.querySelector('option')
    if (first) fontSelect.value = first.value
  }
  fontSelect.disabled = fonts.length === 0
}

function filterFonts(query: string): void {
  const q = query.trim().toLowerCase()
  if (!q) {
    populateFontSelect(allFonts)
    return
  }
  populateFontSelect(allFonts.filter((f) => f.toLowerCase().includes(q)))
}

async function loadImage(result: OpenImageResult): Promise<void> {
  currentImage = result
  await editor.loadImage(result)

  emptyHint.hidden = true
  btnOpenEmpty.hidden = true
  editorControls.disabled = false

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
    setMsg(`Open failed: ${asMessage(err)}`, 'error')
  }
}

async function handleDroppedFile(file: File): Promise<void> {
  try {
    const filePath = api.getPathForFile(file)
    if (!filePath) {
      setMsg('Could not resolve the dropped file path.', 'error')
      return
    }
    if (!isSupportedImagePath(filePath)) {
      setMsg(UNSUPPORTED_FORMAT_MESSAGE, 'error')
      return
    }
    const result = await api.openImage({ path: filePath })
    if (!result) return
    await loadImage(result)
    clearMsg()
  } catch (err) {
    setMsg(`Open failed: ${asMessage(err)}`, 'error')
  }
}

function attachDropTarget(): void {
  let dragDepth = 0
  const hasFiles = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')

  document.body.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth++
    document.body.classList.add('drop-active')
  })
  document.body.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
  })
  document.body.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) document.body.classList.remove('drop-active')
  })
  document.body.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    document.body.classList.remove('drop-active')
    const file = e.dataTransfer?.files?.[0]
    if (file) void handleDroppedFile(file)
  })
}

async function handleSave(): Promise<void> {
  if (!currentImage) return

  const v = editor.validateText(editor.text)
  if (!v.valid) {
    setMsg(v.error ?? 'Watermark text is required.', 'error')
    return
  }

  const textLayer = editor.renderFullResTextLayer()
  if (!textLayer) {
    setMsg('No text layer to save.', 'error')
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
      setMsg(`Saved to ${result.savedPath}`, 'ok')
    }
  } catch (err) {
    setMsg(`Save failed: ${asMessage(err)}`, 'error')
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
  btnOpenEmpty.addEventListener('click', handleOpen)
  btnSave.addEventListener('click', handleSave)
  attachDropTarget()

  fontSelect.addEventListener('change', () => {
    editor.changeFont(fontSelect.value)
  })
  fontSearch.addEventListener('input', () => {
    filterFonts(fontSearch.value)
  })
  fontWeightSelect.addEventListener('change', () => {
    editor.changeFontWeight(fontWeightSelect.value)
  })
  fontSizeInput.addEventListener('input', () => {
    editor.changeFontSize(Number(fontSizeInput.value))
  })
  opacitySlider.addEventListener('input', () => {
    editor.changeOpacity(Number(opacitySlider.value) / 100)
  })

  try {
    const fonts = await api.listFonts()
    allFonts = [...fonts].map(cleanFontName).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    populateFontSelect(allFonts)
    fontSearch.disabled = false
    fontWeightSelect.disabled = false
  } catch (err) {
    setMsg(`Font enumeration failed: ${asMessage(err)}`, 'error')
  }
}

void boot()