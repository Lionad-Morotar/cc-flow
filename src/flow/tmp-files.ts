import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const TMP_DIR = '/tmp/cc-flow/node-shots'
export const tmpFilesDir = TMP_DIR
const THUMB_TARGET_BYTES = 200 * 1024
const FULL_MAX_BYTES = 3 * 1024 * 1024

export interface ScreenshotPaths {
  /** 200KB 快速预览版本；当 full 本身已 ≤200KB 时为空字符串（单图模式） */
  thumb: string
  /** 90% 质量原图版本（最大 3MB） */
  full: string
}

function parseDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]*)$/)
  if (!match) {
    throw new Error('Invalid image data URL: expected data:image/png;base64,... or data:image/jpeg;base64,...')
  }
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) {
    throw new Error('Empty image data')
  }
  return buffer
}

async function getMetadata(buffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Failed to read image dimensions')
  }
  return { width: metadata.width, height: metadata.height }
}

async function compressToThumb(buffer: Buffer): Promise<Buffer> {
  const { width } = await getMetadata(buffer)
  let quality = 80
  let scale = 1
  const minQuality = 50
  const minScale = 0.25
  const maxIterations = 20
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++
    const targetWidth = Math.max(1, Math.round(width * scale))
    const output = await sharp(buffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer()

    if (output.length <= THUMB_TARGET_BYTES || (quality <= minQuality && scale <= minScale)) {
      return output
    }

    if (quality > minQuality) {
      quality -= 5
    } else {
      scale *= 0.75
    }
  }

  // 达到最大迭代次数，返回最后一次结果
  const targetWidth = Math.max(1, Math.round(width * scale))
  return sharp(buffer)
    .resize({ width: targetWidth, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer()
}

async function compressToFull(buffer: Buffer): Promise<Buffer> {
  const { width } = await getMetadata(buffer)
  let quality = 90
  let scale = 1
  const minQuality = 70
  const minScale = 0.5
  const maxIterations = 20
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++
    const targetWidth = Math.max(1, Math.round(width * scale))
    const output = await sharp(buffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer()

    if (output.length <= FULL_MAX_BYTES || (quality <= minQuality && scale <= minScale)) {
      return output
    }

    if (quality > minQuality) {
      quality -= 5
    } else {
      scale *= 0.9
    }
  }

  // 达到最大迭代次数，返回最后一次结果
  const targetWidth = Math.max(1, Math.round(width * scale))
  return sharp(buffer)
    .resize({ width: targetWidth, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer()
}

/**
 * 保存截图到临时目录。full 始终生成（90% 质量，最大 3MB）；thumb（约 200KB）仅当
 * full 本身大于 200KB 时才生成——小图单图模式，thumb 与 full 等价时省去预览版。
 */
export async function saveScreenshot(dataUrl: string): Promise<ScreenshotPaths> {
  const buffer = parseDataUrl(dataUrl)
  const id = randomUUID()
  const dir = join(TMP_DIR, id)
  await mkdir(dir, { recursive: true })

  const fullBuffer = await compressToFull(buffer)
  const fullPath = join(dir, 'full.webp')

  // 单图模式：full 已足够小，不生成 thumb，提示词只给 full 一张
  if (fullBuffer.length <= THUMB_TARGET_BYTES) {
    await writeFile(fullPath, fullBuffer)
    return { thumb: '', full: fullPath }
  }

  const thumbBuffer = await compressToThumb(buffer)
  const thumbPath = join(dir, 'thumb.webp')
  await Promise.all([writeFile(thumbPath, thumbBuffer), writeFile(fullPath, fullBuffer)])

  return { thumb: thumbPath, full: fullPath }
}

/** 扩展名仅允许字母数字，防路径遍历 */
function safeExt(ext: string): string {
  const cleaned = ext.replace(/[^a-zA-Z0-9]/g, '')
  return cleaned || 'txt'
}

/**
 * 保存任意文本到临时目录（如过大的 outerHTML），返回文件绝对路径。
 * LLM 按需读取，避免大文本污染提示词上下文。
 */
export async function saveTextFile(content: string, ext = 'txt'): Promise<string> {
  const id = randomUUID()
  const dir = join(TMP_DIR, id)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `content.${safeExt(ext)}`)
  await writeFile(path, content, 'utf-8')
  return path
}
