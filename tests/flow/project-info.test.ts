import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inferProjectInfo } from '../../src/flow/project-info.js'

describe('project-info', () => {
  let baseDir: string
  const originalCwd = process.cwd()

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'cc-flow-project-info-'))
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(baseDir, { recursive: true, force: true })
  })

  it('infers project info from a directory with package.json', async () => {
    const projectDirRaw = join(baseDir, 'my-project')
    await mkdir(projectDirRaw, { recursive: true })
    await writeFile(
      join(projectDirRaw, 'package.json'),
      JSON.stringify({ name: '@lionad/cc-flow' }),
      'utf-8',
    )
    const projectDir = await realpath(projectDirRaw)
    process.chdir(projectDir)

    const info = await inferProjectInfo()

    expect(info.path).toBe(projectDir)
    expect(info.rootPath).toBe(projectDir)
    expect(info.name).toBe('@lionad/cc-flow')
  })

  it('finds rootPath in a parent directory containing package.json', async () => {
    const rootDirRaw = join(baseDir, 'monorepo')
    const subDirRaw = join(rootDirRaw, 'packages', 'core')
    await mkdir(subDirRaw, { recursive: true })
    await writeFile(
      join(rootDirRaw, 'package.json'),
      JSON.stringify({ name: 'monorepo' }),
      'utf-8',
    )
    const rootDir = await realpath(rootDirRaw)
    const subDir = await realpath(subDirRaw)
    process.chdir(subDir)

    const info = await inferProjectInfo()

    expect(info.path).toBe(subDir)
    expect(info.rootPath).toBe(rootDir)
    expect(info.name).toBe('monorepo')
  })

  it('falls back to .git directory when no package.json exists', async () => {
    const projectDirRaw = join(baseDir, 'git-only-project')
    await mkdir(join(projectDirRaw, '.git'), { recursive: true })
    const projectDir = await realpath(projectDirRaw)
    process.chdir(projectDir)

    const info = await inferProjectInfo()

    expect(info.path).toBe(projectDir)
    expect(info.rootPath).toBe(projectDir)
    expect(info.name).toBe(projectDir)
  })

  it('falls back to current directory when no marker is found', async () => {
    const orphanDirRaw = join(baseDir, 'orphan')
    await mkdir(orphanDirRaw, { recursive: true })
    const orphanDir = await realpath(orphanDirRaw)
    process.chdir(orphanDir)

    const info = await inferProjectInfo()

    expect(info.path).toBe(orphanDir)
    expect(info.rootPath).toBe(orphanDir)
    expect(info.name).toBe(orphanDir)
  })

  it('does not treat the home directory package.json as a project name', async () => {
    const fakeHomeRaw = join(baseDir, 'fake-home')
    await mkdir(fakeHomeRaw, { recursive: true })
    await writeFile(
      join(fakeHomeRaw, 'package.json'),
      JSON.stringify({ name: 'home-dotfiles' }),
      'utf-8',
    )
    const fakeHome = await realpath(fakeHomeRaw)

    const originalHome = process.env.HOME
    process.env.HOME = fakeHome
    process.chdir(fakeHome)

    try {
      const info = await inferProjectInfo()
      expect(info.path).toBe(fakeHome)
      expect(info.rootPath).toBe(fakeHome)
      expect(info.name).toBe(fakeHome)
    } finally {
      process.env.HOME = originalHome
    }
  })
})
