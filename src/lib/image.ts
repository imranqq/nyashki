export type CropTarget = 'avatar' | 'banner'

export type LoadedImage = {
  url: string
  width: number
  height: number
  element: HTMLImageElement
}

export type CropGeometry = {
  zoom: number
  offsetX: number
  offsetY: number
}

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
// The avatar travels with every chat message, the banner only with the profile card.
export const AVATAR_MAX_CHARS = 8192
export const BANNER_MAX_CHARS = 60000
export const BANNER_ASPECT = 2.9

const avatarAttempts = [
  { size: 192, quality: 0.82 },
  { size: 160, quality: 0.72 },
  { size: 144, quality: 0.62 },
  { size: 128, quality: 0.55 },
  { size: 112, quality: 0.45 },
]
const bannerAttempts = [
  { width: 640, quality: 0.75 },
  { width: 560, quality: 0.65 },
  { width: 480, quality: 0.55 },
  { width: 420, quality: 0.45 },
]

export const clampOffset = (value: number): number => Math.min(1, Math.max(-1, value))

export function cropMaxChars(target: CropTarget): number {
  return target === 'avatar' ? AVATAR_MAX_CHARS : BANNER_MAX_CHARS
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('not-an-image')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('file-too-large')
  const url = URL.createObjectURL(file)
  const element = new Image()
  element.src = url
  try {
    if (typeof element.decode === 'function') await element.decode()
    else await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve()
      element.onerror = () => reject(new Error('unreadable'))
    })
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('unreadable')
  }
  return { url, width: element.naturalWidth, height: element.naturalHeight, element }
}

export function releaseLoadedImage(image: LoadedImage | null) {
  if (image) URL.revokeObjectURL(image.url)
}

// The workspace shows the photo "cover"-scaled; offsets map the visible frame back to source pixels.
function sourceRect(image: HTMLImageElement, viewportWidth: number, viewportHeight: number, geometry: CropGeometry) {
  const naturalWidth = image.naturalWidth || 1
  const naturalHeight = image.naturalHeight || 1
  const width = Math.max(1, viewportWidth)
  const height = Math.max(1, viewportHeight)
  const coverScale = Math.max(width / naturalWidth, height / naturalHeight)
  const scale = coverScale * Math.max(1, geometry.zoom)
  const overflowX = Math.max(0, naturalWidth * scale - width) / 2
  const overflowY = Math.max(0, naturalHeight * scale - height) / 2
  const shiftX = clampOffset(geometry.offsetX) * overflowX
  const shiftY = clampOffset(geometry.offsetY) * overflowY
  const sourceWidth = Math.min(naturalWidth, width / scale)
  const sourceHeight = Math.min(naturalHeight, height / scale)
  const maxX = Math.max(0, naturalWidth - sourceWidth)
  const maxY = Math.max(0, naturalHeight - sourceHeight)
  return {
    x: Math.min(maxX, Math.max(0, (naturalWidth - sourceWidth) / 2 - shiftX / scale)),
    y: Math.min(maxY, Math.max(0, (naturalHeight - sourceHeight) / 2 - shiftY / scale)),
    width: sourceWidth,
    height: sourceHeight,
  }
}

export function drawCrop(
  image: HTMLImageElement,
  viewportWidth: number,
  viewportHeight: number,
  geometry: CropGeometry,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(targetWidth))
  canvas.height = Math.max(1, Math.round(targetHeight))
  const context = canvas.getContext('2d')
  const source = sourceRect(image, viewportWidth, viewportHeight, geometry)
  if (context) {
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height)
  }
  return canvas
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality)
  if (webp.startsWith('data:image/webp')) return webp
  return canvas.toDataURL('image/jpeg', quality)
}

// Falls back through smaller sizes until the data URL fits what the room server accepts.
export function cropToDataUrl(
  image: HTMLImageElement,
  viewportWidth: number,
  viewportHeight: number,
  geometry: CropGeometry,
  target: CropTarget,
): string {
  const attempts = target === 'avatar' ? avatarAttempts : bannerAttempts
  const maxChars = target === 'avatar' ? AVATAR_MAX_CHARS : BANNER_MAX_CHARS
  for (const attempt of attempts) {
    const width = 'size' in attempt ? attempt.size : attempt.width
    const height = 'size' in attempt ? attempt.size : Math.round(attempt.width / BANNER_ASPECT)
    const dataUrl = encodeCanvas(drawCrop(image, viewportWidth, viewportHeight, geometry, width, height), attempt.quality)
    if (dataUrl.length <= maxChars) return dataUrl
  }
  throw new Error('image-too-large')
}

export function cropPreviewUrl(
  image: HTMLImageElement,
  viewportWidth: number,
  viewportHeight: number,
  geometry: CropGeometry,
  target: CropTarget,
): string {
  const width = target === 'avatar' ? 96 : 232
  const height = target === 'avatar' ? 96 : Math.round(232 / BANNER_ASPECT)
  return encodeCanvas(drawCrop(image, viewportWidth, viewportHeight, geometry, width, height), 0.7)
}

export function describeImageError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'not-an-image') return 'Это не картинка. Подойдёт JPG, PNG или WebP.'
  if (message === 'file-too-large') return 'Файл больше 12 МБ. Выбери фото поменьше.'
  if (message === 'image-too-large') return 'Слишком большое фото. Выбери картинку поменьше.'
  return 'Не удалось прочитать файл. Попробуй другое фото.'
}
