import { contextBridge, ipcRenderer } from 'electron'
import type { IpcBridge, IpcChannelMap } from '../shared/ipc'

function invoke<K extends keyof IpcChannelMap>(
  channel: K,
  request?: IpcChannelMap[K]['request']
): Promise<IpcChannelMap[K]['response']> {
  return ipcRenderer.invoke(channel, request)
}

const bridge: IpcBridge = {
  listFonts: () => invoke('list-fonts'),
  openImage: () => invoke('open-image'),
  getFrameCount: (request) => invoke('get-frame-count', request),
  renderTextLayer: (request) => invoke('render-text-layer', request),
  saveImage: (request) => invoke('save-image', request),
}

contextBridge.exposeInMainWorld('api', bridge)