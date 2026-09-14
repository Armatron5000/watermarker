export const SUPPORTED_FORMATS = ['png', 'jpeg', 'webp', 'tiff', 'gif'] as const
export type ImageFormat = (typeof SUPPORTED_FORMATS)[number]

export const IPC_CHANNELS = [
  'list-fonts',
  'open-image',
  'save-image',
  'get-frame-count',
  'render-text-layer',
] as const
export type IpcChannel = (typeof IPC_CHANNELS)[number]

export interface OpenImageResult {
  path: string
  name: string
  format: ImageFormat
  width: number
  height: number
  frameCount: number
  previewDataUrl: string
}

export interface GetFrameCountRequest {
  path: string
}

export interface TextLayer {
  data: Uint8Array
  width: number
  height: number
}

export interface RenderTextLayerRequest {
  sourcePath: string
  textLayer: TextLayer
  x: number
  y: number
}

export interface RenderTextLayerResult {
  format: ImageFormat
  width: number
  height: number
  dataUrl: string
}

export interface SaveImageRequest {
  sourcePath: string
  format: ImageFormat
  defaultName: string
  textLayer: TextLayer
  x: number
  y: number
}

export interface SaveImageResult {
  savedPath: string
}

export interface IpcChannelMap {
  'list-fonts': { request: void; response: string[] }
  'open-image': { request: void; response: OpenImageResult | null }
  'get-frame-count': { request: GetFrameCountRequest; response: number }
  'render-text-layer': { request: RenderTextLayerRequest; response: RenderTextLayerResult }
  'save-image': { request: SaveImageRequest; response: SaveImageResult | null }
}

export interface IpcBridge {
  listFonts(): Promise<IpcChannelMap['list-fonts']['response']>
  openImage(): Promise<IpcChannelMap['open-image']['response']>
  getFrameCount(request: IpcChannelMap['get-frame-count']['request']): Promise<IpcChannelMap['get-frame-count']['response']>
  renderTextLayer(request: IpcChannelMap['render-text-layer']['request']): Promise<IpcChannelMap['render-text-layer']['response']>
  saveImage(request: IpcChannelMap['save-image']['request']): Promise<IpcChannelMap['save-image']['response']>
}