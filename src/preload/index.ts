import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcBridge, IpcChannelMap, OpenImageRequest } from '../shared/ipc'

function invoke<K extends keyof IpcChannelMap>(
  channel: K,
  request?: IpcChannelMap[K]['request']
): Promise<IpcChannelMap[K]['response']> {
  return ipcRenderer.invoke(channel, request)
}

const bridge: IpcBridge = {
  listFonts: () => invoke('list-fonts'),
  openImage: (request?: OpenImageRequest) => invoke('open-image', request),
  getFrameCount: (request) => invoke('get-frame-count', request),
  renderTextLayer: (request) => invoke('render-text-layer', request),
  saveImage: (request) => invoke('save-image', request),
  getPathForFile: (file: unknown) =>
    webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
}

contextBridge.exposeInMainWorld('api', bridge)