import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import sharp from 'sharp'
import { saveScreenshot, saveTextFile } from '../../src/flow/tmp-files.js'

describe('tmp-files', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true })
    }
    createdDirs.length = 0
  })

  function tinyPngDataUrl(): string {
    // 1x1 红色 PNG，base64
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  }

  async function largePngDataUrl(): Promise<string> {
    // 随机噪声图：webp 难压缩，保证 full > 200KB 触发双图模式
    const width = 1200
    const height = 1200
    const raw = Buffer.alloc(width * height * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
    const buf = await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
    return `data:image/png;base64,${buf.toString('base64')}`
  }

  it('small image → single mode: empty thumb, only full exists', async () => {
    const paths = await saveScreenshot(tinyPngDataUrl())

    createdDirs.push(paths.full.replace('/full.webp', ''))

    expect(paths.thumb).toBe('')
    expect(existsSync(paths.full)).toBe(true)
    expect(statSync(paths.full).size).toBeLessThanOrEqual(200 * 1024)
  })

  it('large image → dual mode: both thumb and full exist', async () => {
    const paths = await saveScreenshot(await largePngDataUrl())

    createdDirs.push(paths.full.replace('/full.webp', ''))

    expect(paths.thumb).not.toBe('')
    expect(existsSync(paths.thumb)).toBe(true)
    expect(existsSync(paths.full)).toBe(true)
    expect(paths.thumb.endsWith('/thumb.webp')).toBe(true)
    expect(paths.full.endsWith('/full.webp')).toBe(true)
  })

  it('rejects invalid data URL', async () => {
    await expect(saveScreenshot('not-a-data-url')).rejects.toThrow('Invalid image data URL')
  })

  it('rejects empty image data', async () => {
    await expect(saveScreenshot('data:image/png;base64,')).rejects.toThrow('Empty image data')
  })

  it('saveTextFile writes content and returns path with safe ext', async () => {
    const path = await saveTextFile('<div>hello</div>', 'html')
    createdDirs.push(path.replace('/content.html', ''))

    const { readFileSync } = await import('node:fs')
    expect(path.endsWith('/content.html')).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe('<div>hello</div>')
  })

  it('saveTextFile sanitizes unsafe ext (strips path separators)', async () => {
    const path = await saveTextFile('x', '../../../etc')
    createdDirs.push(path.replace(/\/content\.[^.]+$/, ''))

    // 非字母数字字符被剥离，无路径遍历
    expect(path).not.toContain('..')
    expect(path.endsWith('/content.etc')).toBe(true)
  })
})
