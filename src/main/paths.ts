import type { ImageFormat } from '../shared/ipc'

export function extensionFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

export function withDefaultExtension(defaultName: string, ext: string): string {
  return /\.(png|jpe?g|webp|tiff?|gif)$/i.test(defaultName) ? defaultName : `${defaultName}.${ext}`
}

export function isSourceExtension(filePath: string, format: ImageFormat): boolean {
  const ext = format === 'jpeg' ? 'jpe?g' : extensionFor(format)
  return new RegExp(`\\.${ext}$`, 'i').test(filePath)
}

export function lockExtension(filePath: string, format: ImageFormat): string {
  return isSourceExtension(filePath, format) ? filePath : `${filePath}.${extensionFor(format)}`
}

export function outputFormat(metaFormat: string): ImageFormat {
  return (metaFormat === 'jpeg' || metaFormat === 'jpg' ? 'jpeg' : metaFormat) as ImageFormat
}