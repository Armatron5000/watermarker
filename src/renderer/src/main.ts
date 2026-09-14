const statusEl = document.querySelector<HTMLSpanElement>('#bridge-status')
const fontSelect = document.querySelector<HTMLSelectElement>('#font-select')
const noteEl = document.querySelector<HTMLParagraphElement>('#ipc-note')

function setStatus(text: string, className: string): void {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.className = `status ${className}`
}

async function boot(): Promise<void> {
  const api = window.api
  if (!api) {
    setStatus('bridge unavailable', 'status-error')
    if (noteEl) noteEl.textContent = 'window.api was not exposed by the preload script.'
    return
  }

  setStatus('bridge connected', 'status-ok')

  try {
    const fonts = await api.listFonts()
    if (fontSelect) {
      for (const font of fonts) {
        const option = document.createElement('option')
        option.value = font
        option.textContent = font
        fontSelect.appendChild(option)
      }
      fontSelect.disabled = false
    }
    if (noteEl) noteEl.textContent = `${fonts.length} families enumerated from main via font-list.`
  } catch (err) {
    setStatus('bridge error', 'status-error')
    if (noteEl) noteEl.textContent = `listFonts failed: ${String(err)}`
  }
}

void boot()