import { ipcMain } from 'electron'
import { getFonts } from 'font-list'
import type { IpcChannelMap } from '../shared/ipc'

function notImplemented(channel: string): never {
  throw new Error(`${channel} is not implemented yet (planned for the core pipeline milestone)`)
}

function registerChannel<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    request: IpcChannelMap[K]['request']
  ) => IpcChannelMap[K]['response'] | Promise<IpcChannelMap[K]['response']>
): void {
  ipcMain.handle(channel, (_event, request: IpcChannelMap[K]['request']) => handler(request))
}

export function registerIpcHandlers(): void {
  registerChannel('list-fonts', async () => getFonts())

  registerChannel('open-image', () => notImplemented('open-image'))
  registerChannel('get-frame-count', () => notImplemented('get-frame-count'))
  registerChannel('render-text-layer', () => notImplemented('render-text-layer'))
  registerChannel('save-image', () => notImplemented('save-image'))
}