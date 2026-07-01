import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeRegistry } from '../../src/flow/registry.js'
import { getTeamDir } from '../../src/flow/paths.js'
import type { FlowRegistryEntry } from '../../src/flow/types.js'

const repoRoot = join(import.meta.dirname, '..', '..')
const cleanupScript = join(repoRoot, 'scripts/flow-cleanup.js')

describe('cleanup', () => {
  let registryDir: string
  let teamsDir: string
  const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-cleanup-reg-'))
    teamsDir = await mkdtemp(join(tmpdir(), 'cc-flow-cleanup-teams-'))
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

  function runCleanup(sessionId: string): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cleanupScript],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CC_FLOW_REGISTRY_DIR: registryDir,
            CC_FLOW_TEAMS_DIR: teamsDir,
          },
          stdio: ['pipe', 'ignore', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr!.on('data', chunk => (stderr += chunk.toString()))
      child.on('error', reject)
      child.on('close', code => resolve({ code: code ?? 1, stderr }))
      child.stdin!.write(JSON.stringify({ session_id: sessionId }))
      child.stdin!.end()
    })
  }

  it('cleans registry, bridge, and team dir for the given session', async () => {
    const sessionId = 'cleanup-session-1234'
    const sessionShortId = sessionId.slice(0, 8)
    const teamName = 'cc-flow-cleanup-test'
    const teamDir = getTeamDir(teamName)
    await mkdir(teamDir, { recursive: true })
    await writeFile(join(teamDir, 'config.json'), JSON.stringify({ name: teamName }), 'utf-8')

    // Spawn a child process that we can later verify was killed.
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: 'ignore',
    })
    sleeper.unref()

    const entry: FlowRegistryEntry = {
      sessionId,
      sessionShortId,
      teamName,
      teamDir,
      port: 12345,
      pid: sleeper.pid!,
      authToken: 'cleanup-token',
      startedAt: new Date().toISOString(),
      description: 'cleanup test',
      project: { name: 'cleanup', path: '/tmp', rootPath: '/tmp' },
    }
    await writeRegistry(entry)

    const { code, stderr } = await runCleanup(sessionId)
    expect(code).toBe(0)
    expect(stderr).toContain(`cleaned session ${sessionShortId}`)

    await expect(readFile(join(registryDir, `${sessionShortId}.json`), 'utf-8')).rejects.toThrow(
      'ENOENT',
    )
    await expect(readFile(join(teamDir, 'config.json'), 'utf-8')).rejects.toThrow('ENOENT')

    // Give killBridge time to take effect.
    await sleep(500)
    try {
      process.kill(sleeper.pid!, 0)
      throw new Error('sleeper should have been killed')
    } catch {
      // Expected: process no longer exists.
    }
  })

  it('exits cleanly when no registry exists for the session', async () => {
    const { code } = await runCleanup('no-such-session-0000')
    expect(code).toBe(0)
  })

  it('fails with a non-zero exit code on malformed stdin JSON', async () => {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cleanupScript],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CC_FLOW_REGISTRY_DIR: registryDir,
            CC_FLOW_TEAMS_DIR: teamsDir,
          },
          stdio: ['pipe', 'ignore', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr!.on('data', chunk => (stderr += chunk.toString()))
      child.on('error', reject)
      child.on('close', code => {
        expect(code).not.toBe(0)
        expect(stderr).toContain('failed to parse hook input JSON')
        resolve()
      })
      child.stdin!.write('not-valid-json')
      child.stdin!.end()
    })
  })
})
