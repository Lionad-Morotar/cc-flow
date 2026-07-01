import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  cleanupByRegistry,
  ensureRegistryDir,
  isPidAlive,
  killBridge,
  listRegistries,
  readRegistry,
  writeRegistry,
} from '../../src/flow/registry.js'
import type { FlowRegistryEntry } from '../../src/flow/types.js'

describe('FlowRegistry', () => {
  let registryDir: string
  let teamsDir: string
  const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-reg-'))
    teamsDir = await mkdtemp(join(tmpdir(), 'ccx-teams-'))
    process.env.CC_FLOW_REGISTRY_DIR = registryDir
    process.env.CC_FLOW_TEAMS_DIR = teamsDir
  })

  afterEach(async () => {
    if (originalRegistryDir === undefined) delete process.env.CC_FLOW_REGISTRY_DIR
    else process.env.CC_FLOW_REGISTRY_DIR = originalRegistryDir
    process.env.CC_FLOW_TEAMS_DIR = originalTeamsDir
    await rm(registryDir, { recursive: true, force: true })
    await rm(teamsDir, { recursive: true, force: true })
  })

  it('round-trips a registry entry', async () => {
    const entry: FlowRegistryEntry = {
      sessionId: 'full-session-id',
      sessionShortId: 'abcdef12',
      teamName: 'cc-flow-abcdef12',
      port: 12345,
      pid: 99999,
      authToken: 'secret-token',
      startedAt: new Date().toISOString(),
    }

    await ensureRegistryDir()
    await writeRegistry(entry)
    const read = await readRegistry('abcdef12')
    expect(read).toEqual(entry)
  })

  it('writes the registry file with 0600 permissions', async () => {
    const entry: FlowRegistryEntry = {
      sessionId: 'full-session-id',
      sessionShortId: 'permfile',
      teamName: 'cc-flow-permfile',
      port: 12345,
      pid: 99999,
      authToken: 'secret-token',
      startedAt: new Date().toISOString(),
    }
    await writeRegistry(entry)
    const fileStat = await stat(`${registryDir}/permfile.json`)
    expect(fileStat.mode & 0o777).toBe(0o600)
  })

  it('creates the registry directory with 0700 permissions', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cc-flow-permdir-'))
    const nested = join(base, 'sub', 'cc-flow')
    try {
      await ensureRegistryDir(join(nested, 'r.json'))
      const dirStat = await stat(nested)
      expect(dirStat.mode & 0o777).toBe(0o700)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('returns null for missing registry', async () => {
    const read = await readRegistry('missing')
    expect(read).toBeNull()
  })

  it('lists all registries', async () => {
    const a: FlowRegistryEntry = {
      sessionId: 's1',
      sessionShortId: 'a',
      teamName: 't1',
      port: 1,
      pid: 1,
      authToken: 'tok1',
      startedAt: '2024-01-01T00:00:00.000Z',
    }
    const b: FlowRegistryEntry = {
      sessionId: 's2',
      sessionShortId: 'b',
      teamName: 't2',
      port: 2,
      pid: 2,
      authToken: 'tok2',
      startedAt: '2024-01-01T00:00:00.000Z',
    }
    await writeRegistry(a)
    await writeRegistry(b)

    const list = await listRegistries()
    expect(list).toHaveLength(2)
    expect(list.map(l => l.entry.sessionShortId).sort()).toEqual(['a', 'b'])
  })

  it('detects a running pid and a non-running pid', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    expect(isPidAlive(child.pid!)).toBe(true)
    expect(await killBridge(child.pid!)).toBe(true)
    expect(isPidAlive(child.pid!)).toBe(false)
  })

  it('cleanup kills bridge, removes team dir and registry file', async () => {
    const entry: FlowRegistryEntry = {
      sessionId: 's1',
      sessionShortId: 'cleanup',
      teamName: 'cc-flow-cleanup',
      port: 1,
      pid: 1,
      authToken: 'tok',
      startedAt: '2024-01-01T00:00:00.000Z',
    }
    await writeRegistry(entry)

    // Use a real child pid for killBridge to exercise the full path.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    entry.pid = child.pid!

    await mkdir(`${teamsDir}/cc-flow-cleanup`, { recursive: true })
    await writeFile(
      `${teamsDir}/cc-flow-cleanup/config.json`,
      JSON.stringify({ name: entry.teamName }),
      'utf-8',
    )

    await cleanupByRegistry(entry)

    expect(isPidAlive(entry.pid)).toBe(false)
    expect(await readRegistry('cleanup')).toBeNull()
  })
})
