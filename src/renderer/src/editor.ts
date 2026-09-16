import type { OpenImageResult } from '../../shared/ipc'
import './assets/overlay.css'

export interface TextLayerData {
  data: Uint8Array
  width: number
  height: number
}

export function cssFontFamily(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name
}

export function cleanFontName(font: string): string {
  return font.length > 1 && font.startsWith('"') && font.endsWith('"') ? font.slice(1, -1) : font
}

export class Editor {
  private previewArea: HTMLElement
  private stage!: HTMLDivElement
  private overlay!: HTMLDivElement
  private imgEl!: HTMLImageElement
  private textBox!: HTMLDivElement
  private rotateHandle!: HTMLDivElement
  private nwHandle!: HTMLDivElement
  private neHandle!: HTMLDivElement
  private seHandle!: HTMLDivElement
  private swHandle!: HTMLDivElement

  image: OpenImageResult | null = null
  private scale = 1

  text = ''
  font = 'sans-serif'
  fontWeight = 700
  fontSize = 32
  opacity = 0.5
  textX = 0
  textY = 0
  textW = 200
  rotation = 0

  onTextLayerChange: (() => void) | null = null

  private dragging = false
  private dragStartX = 0
  private dragStartY = 0
  private dragOrigX = 0
  private dragOrigY = 0
  private didDrag = false

  private rotating = false
  private rotStartX = 0
  private rotStartY = 0
  private rotOrig = 0

  private resizing = false
  private resizeHandle = ''
  private resizeStartX = 0
  private resizeStartY = 0

  constructor(previewArea: HTMLElement) {
    this.previewArea = previewArea
  }

  loadImage(result: OpenImageResult): Promise<void> {
    this.image = result
    this.text = ''
    this.rotation = 0

    this.removeWindowListeners()
    this.previewArea.innerHTML = ''
    this.previewArea.classList.add('no-select')
    this.previewArea.classList.remove('empty')

    this.stage = document.createElement('div')
    this.stage.className = 'editor-stage'
    this.previewArea.appendChild(this.stage)

    this.imgEl = document.createElement('img')
    this.imgEl.className = 'preview-img'
    this.imgEl.src = result.previewDataUrl
    this.stage.appendChild(this.imgEl)

    return new Promise<void>((resolve, reject) => {
      this.imgEl.onload = () => {
        try {
          this.scaleOverlay()
          this.createOverlay()
          this.createTextBox()
          this.syncTextBox()
          resolve()
        } catch (err) {
          reject(err)
        }
      }
      this.imgEl.onerror = () => reject(new Error('Failed to decode preview'))
    })
  }

  changeFont(font: string): void {
    this.font = font
    this.syncTextBox()
    this.onTextLayerChange?.()
  }

  changeFontWeight(weight: string): void {
    this.fontWeight = Number(weight) || 700
    this.syncTextBox()
    this.onTextLayerChange?.()
  }

  changeFontSize(size: number): void {
    this.fontSize = size
    this.syncTextBox()
    this.onTextLayerChange?.()
  }

  changeOpacity(opacity: number): void {
    this.opacity = opacity
    if (this.textBox) this.textBox.style.opacity = String(opacity)
    this.onTextLayerChange?.()
  }

  validateText(raw: string): { valid: boolean; text: string; error?: string } {
    const trimmed = raw.trim()
    if (!trimmed) return { valid: false, text: '', error: 'Watermark text cannot be blank.' }
    const len = [...trimmed].length
    if (len > 100)
      return { valid: false, text: trimmed, error: `Text is ${len} characters (max 100).` }
    return { valid: true, text: trimmed }
  }

  renderFullResTextLayer(): TextLayerData | null {
    if (!this.image) return null
    const { width, height } = this.image
    const off = document.createElement('canvas')
    off.width = width
    off.height = height
    const ctx = off.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    if (!this.text) {
      const imageData = ctx.getImageData(0, 0, width, height)
      return { data: new Uint8Array(imageData.data.buffer), width, height }
    }

    const fs = this.fontSize / this.scale
    ctx.font = `${this.fontWeight} ${fs}px ${cssFontFamily(this.font)}`
    const lines = this.wrapText(this.text, this.textW / this.scale, ctx)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const lh = fs * 1.2

    ctx.save()
    ctx.translate(this.textX / this.scale, this.textY / this.scale)
    ctx.rotate((this.rotation * Math.PI) / 180)
    ctx.globalAlpha = this.opacity
    ctx.fillStyle = 'white'
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 0, lh / 2 + i * lh)
    }
    ctx.restore()

    const imageData = ctx.getImageData(0, 0, width, height)
    return { data: new Uint8Array(imageData.data.buffer), width, height }
  }

  private scaleOverlay(): void {
    if (!this.image) return
    const areaW = this.previewArea.clientWidth || 800
    const areaH = 500
    const imgW = this.image.width
    const imgH = this.image.height
    this.scale = Math.min(areaW / imgW, areaH / imgH, 1)
    this.imgEl.style.width = `${imgW * this.scale}px`
    this.imgEl.style.height = `${imgH * this.scale}px`

    this.textW = Math.max(80, Math.min(240, imgW * this.scale * 0.5))
    this.textX = Math.max(8, (imgW * this.scale - this.textW) / 2)
    this.textY = imgH * this.scale * 0.45
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div')
    this.overlay.className = 'editor-overlay'
    this.stage.appendChild(this.overlay)
  }

  private createTextBox(): void {
    this.textBox = document.createElement('div')
    this.textBox.className = 'editor-text-box'
    this.textBox.contentEditable = 'true'
    this.textBox.spellcheck = false

    this.textBox.addEventListener('mousedown', (e) => this.onTextBoxMouseDown(e))
    this.textBox.addEventListener('input', () => this.onTextInput())
    this.textBox.addEventListener('blur', () => this.onTextBlur())
    this.textBox.addEventListener('keydown', (e) => this.onTextBoxKeyDown(e))

    this.nwHandle = this.createHandle('nw')
    this.neHandle = this.createHandle('ne')
    this.seHandle = this.createHandle('se')
    this.swHandle = this.createHandle('sw')

    this.rotateHandle = document.createElement('div')
    this.rotateHandle.className = 'editor-rotate-handle'
    this.rotateHandle.addEventListener('mousedown', (e) => this.onRotateStart(e))

    this.textBox.appendChild(this.nwHandle)
    this.textBox.appendChild(this.neHandle)
    this.textBox.appendChild(this.seHandle)
    this.textBox.appendChild(this.swHandle)
    this.textBox.appendChild(this.rotateHandle)

    this.overlay.appendChild(this.textBox)

    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  private createHandle(pos: string): HTMLDivElement {
    const h = document.createElement('div')
    h.className = `editor-resize-handle editor-resize-${pos}`
    h.dataset.handle = pos
    h.addEventListener('mousedown', (e) => this.onResizeStart(e))
    return h
  }

  private onTextBoxMouseDown(e: MouseEvent): void {
    if ((e.target as HTMLElement).dataset?.handle) return
    if ((e.target as HTMLElement) === this.rotateHandle) return
    e.preventDefault()
    e.stopPropagation()
    this.dragging = true
    this.didDrag = false
    this.dragStartX = e.clientX
    this.dragStartY = e.clientY
    this.dragOrigX = this.textX
    this.dragOrigY = this.textY
  }

  private onTextInput(): void {
    const raw = this.textBox.innerText ?? ''
    const v = this.validateText(raw)
    if (v.valid) this.text = v.text
    else this.text = raw
    this.syncTextBox()
    this.onTextLayerChange?.()
  }

  private onTextBoxKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.textBox.blur()
  }

  private onTextBlur(): void {
    const raw = this.textBox.innerText ?? ''
    const v = this.validateText(raw)
    this.text = v.text
    this.syncTextBox()
    this.onTextLayerChange?.()
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.dragging) {
      const dx = e.clientX - this.dragStartX
      const dy = e.clientY - this.dragStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.didDrag = true
      if (this.didDrag) {
        this.textX = this.dragOrigX + dx
        this.textY = this.dragOrigY + dy
        this.syncTextBox()
        this.onTextLayerChange?.()
      }
    } else if (this.rotating) {
      const rect = this.overlay.getBoundingClientRect()
      const ax = rect.left + this.textX
      const ay = rect.top + this.textY
      const a = Math.atan2(e.clientY - ay, e.clientX - ax)
      const a0 = Math.atan2(this.rotStartY - ay, this.rotStartX - ax)
      let d = ((a - a0) * 180) / Math.PI
      if (e.shiftKey) d = Math.round(d / 15) * 15
      this.rotation = this.rotOrig + d
      this.syncTextBox()
      this.onTextLayerChange?.()
    } else if (this.resizing) {
      this.applyResize(e.clientX - this.resizeStartX, e.clientY - this.resizeStartY)
      this.syncTextBox()
      this.onTextLayerChange?.()
    }
  }

  private onMouseUp = (e: MouseEvent): void => {
    if (this.dragging && !this.didDrag) {
      this.textBox.focus()
      const range = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (range) {
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
    this.dragging = false
    this.didDrag = false
    this.rotating = false
    this.resizing = false
  }

  private removeWindowListeners(): void {
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }

  private onRotateStart(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    this.rotating = true
    this.rotStartX = e.clientX
    this.rotStartY = e.clientY
    this.rotOrig = this.rotation
  }

  private onResizeStart(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    this.resizing = true
    this.resizeHandle = (e.target as HTMLElement).dataset.handle ?? ''
    this.resizeStartX = e.clientX
    this.resizeStartY = e.clientY
  }

  private applyResize(dx: number, dy: number): void {
    const handle = this.resizeHandle
    const origW = this.textW
    const origFs = this.fontSize
    let factor = 1

    if (handle.includes('e')) factor = (origW + dx) / origW
    else if (handle.includes('w')) factor = (origW - dx) / origW
    else if (handle.includes('s')) factor = (this.fontSize + dy * 0.8) / this.fontSize
    else if (handle.includes('n')) factor = (this.fontSize - dy * 0.8) / this.fontSize

    this.textW = Math.max(40, origW * factor)
    this.fontSize = Math.max(8, origFs * (this.textW / origW))
  }

  private wrapText(text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
    const out: string[] = []
    for (const para of text.split('\n')) {
      if (para === '') {
        out.push('')
        continue
      }
      const words = para.split(' ')
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate
          continue
        }
        if (line) {
          out.push(line)
          line = ''
        }
        if (ctx.measureText(word).width <= maxWidth) {
          line = word
        } else {
          const pieces = this.breakLong(word, maxWidth, ctx)
          for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i])
          line = pieces[pieces.length - 1] ?? ''
        }
      }
      out.push(line)
    }
    return out
  }

  private breakLong(word: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
    const pieces: string[] = []
    let remaining = word
    while (remaining) {
      let cut = remaining.length
      while (cut > 1 && ctx.measureText(remaining.slice(0, cut)).width > maxWidth) cut--
      pieces.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut)
    }
    return pieces
  }

  private syncTextBox(): void {
    if (!this.textBox) return
    this.textBox.style.left = `${this.textX}px`
    this.textBox.style.top = `${this.textY}px`
    this.textBox.style.maxWidth = `${this.textW}px`
    this.textBox.style.transform = `rotate(${this.rotation}deg)`
    this.textBox.style.font = `${this.fontWeight} ${this.fontSize}px ${cssFontFamily(this.font)}`
    this.textBox.style.opacity = String(this.opacity)

    if (this.textBox.matches(':focus')) return

    const handles = [this.nwHandle, this.neHandle, this.seHandle, this.swHandle, this.rotateHandle]
    for (const h of handles) h.remove()
    this.textBox.innerHTML = ''
    if (this.text) {
      const lines = this.text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) this.textBox.appendChild(document.createElement('br'))
        this.textBox.appendChild(document.createTextNode(lines[i]))
      }
    }
    for (const h of handles) this.textBox.appendChild(h)
  }

  dispose(): void {
    this.removeWindowListeners()
  }
}