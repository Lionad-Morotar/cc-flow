import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { request } from 'node:http'
import { readRegistry } from '../../src/flow/registry.js'
import { getTeamConfigPath, getTeamDir, getLeaderInboxPath } from '../../src/flow/paths.js'

const repoRoot = join(import.meta.dirname, '..', '..')
const bootstrapScript = join(repoRoot, 'scripts/flow-bootstrap.js')

/**
 * End-to-end Flow test: bootstrap → inject → status → off.
 *
 * Uses a temp project root and temp teams dir so it never touches real
 * ~/.claude/teams.
 */
describe('flow e2e', () => {
  let registryDir: string
  let teamsDir: string
  let teamName: string
  let sessionId: string
  let sessionShortId: string
  let registryPath: string
  const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-reg-e2e-'))
    teamsDir = await mkdtemp(join(tmpdir(), 'ccx-teams-e2e-'))
    teamName = 'cc-flow-e2e-test'
    sessionId = 'e2e-session-id-5678'
    sessionShortId = sessionId.slice(0, 8)
    registryPath = `${registryDir}/${sessionShortId}.json`
    process.env.CC_FLOW_REGISTRY_DIR = registryDir
    process.env.CC_FLOW_TEAMS_DIR = teamsDir
    await mkdir(getTeamDir(teamName), { recursive: true })
    await writeFile(
      getTeamConfigPath(teamName),
      JSON.stringify({ name: teamName, leadSessionId: sessionId }),
      'utf-8',
    )
  })

  afterEach(async () => {
    if (originalRegistryDir === undefined) delete process.env.CC_FLOW_REGISTRY_DIR
    else process.env.CC_FLOW_REGISTRY_DIR = originalRegistryDir
    process.env.CC_FLOW_TEAMS_DIR = originalTeamsDir
    await rm(registryDir, { recursive: true, force: true })
    await rm(teamsDir, { recursive: true, force: true })
  })

  function runBootstrap(
    args: string[],
    extraEnv: Record<string, string> = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [bootstrapScript, ...args],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CC_FLOW_REGISTRY_DIR: registryDir,
            CC_FLOW_TEAMS_DIR: teamsDir,
            ...extraEnv,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stdout = ''
      let stderr = ''
      child.stdout!.on('data', chunk => (stdout += chunk.toString()))
      child.stderr!.on('data', chunk => (stderr += chunk.toString()))
      child.on('error', reject)
      child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
    })
  }

  function httpPost(port: number, token: string, body: object): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body)
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/inject',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
          },
        },
        res => {
          let data = ''
          res.on('data', chunk => (data += chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, data }))
        },
      )
      req.on('error', reject)
      req.write(payload)
      req.end()
    })
  }

  function httpGet(port: number, token: string): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/status',
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
        res => {
          let data = ''
          res.on('data', chunk => (data += chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, data }))
        },
      )
      req.on('error', reject)
      req.end()
    })
  }

  it('runs the full enable → inject → status → off lifecycle', async () => {
    const token = 'e2e-flow-token-0123456789abcdef0123456789'
    const start = await runBootstrap(
      [
        '--team',
        teamName,
        '--port',
        '0',
        '--session-id',
        sessionId,
        '--registry',
        registryPath,
      ],
      { CC_FLOW_TOKEN: token },
    )
    expect(start.code).toBe(0)

    const entry = await readRegistry(sessionShortId)
    expect(entry).toBeTruthy()
    const port = entry!.port
    expect(port).toBeGreaterThan(0)

    // Inject a message.
    const inject = await httpPost(port, token, {
      text: 'E2E injected message',
      from: 'e2e-flow',
      summary: 'integration test',
      color: 'blue',
    })
    expect(inject.status).toBe(200)

    // Verify mailbox content.
    const mailboxRaw = await readFile(getLeaderInboxPath(teamName), 'utf-8')
    const mailbox = JSON.parse(mailboxRaw)
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0]).toMatchObject({
      from: 'e2e-flow',
      text: 'E2E injected message',
      summary: 'integration test',
      color: 'blue',
      read: false,
    })

    // Status reports one unread message.
    const status = await httpGet(port, token)
    expect(status.status).toBe(200)
    const statusJson = JSON.parse(status.data)
    expect(statusJson.ok).toBe(true)
    expect(statusJson.teamName).toBe(teamName)
    expect(statusJson.queueLength).toBe(1)

    // Off cleans everything.
    const off = await runBootstrap(['--off', '--registry', registryPath])
    expect(off.code).toBe(0)
    expect(off.stdout).toContain('FLOW_OFF: cleaned 1 session(s)')

    // Give the bridge a moment to exit.
    await sleep(500)

    await expect(readFile(registryPath, 'utf-8')).rejects.toThrow('ENOENT')
  })

  it('targets the real team dir even when it diverges from the --team name', async () => {
    // The Agent tool names the team directory itself; here that name differs
    // from what --team would derive. Bootstrap must probe by session and the
    // whole lifecycle (inject + off) must operate on the real directory.
    const divergentSessionId = 'divergent-session-99'
    const divergentShortId = divergentSessionId.slice(0, 8)
    const realTeamDirName = 'session-divergent'
    const divergentTeamName = 'cc-flow-divergent'
    const divergentRegistry = `${registryDir}/${divergentShortId}.json`

    await mkdir(join(teamsDir, realTeamDirName, 'inboxes'), { recursive: true })
    await writeFile(
      join(teamsDir, realTeamDirName, 'config.json'),
      JSON.stringify({ name: realTeamDirName, leadSessionId: divergentSessionId }),
      'utf-8',
    )

    const start = await runBootstrap(
      [
        '--team',
        divergentTeamName,
        '--port',
        '0',
        '--session-id',
        divergentSessionId,
        '--registry',
        divergentRegistry,
      ],
      { CC_FLOW_TOKEN: 'divergent-tok-0123456789abcdef0123456789' },
    )
    expect(start.code).toBe(0)

    const entry = JSON.parse(await readFile(divergentRegistry, 'utf-8'))
    const inject = await httpPost(entry.port, 'divergent-tok-0123456789abcdef0123456789', { text: 'to real dir' })
    expect(inject.status).toBe(200)

    // Inbox landed in the real team dir.
    const mailbox = JSON.parse(
      await readFile(join(teamsDir, realTeamDirName, 'inboxes', 'team-lead.json'), 'utf-8'),
    )
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0].text).toBe('to real dir')

    // The teamName-derived directory was never created.
    await expect(readFile(join(teamsDir, divergentTeamName, 'config.json'), 'utf-8')).rejects.toThrow(
      'ENOENT',
    )

    // off must clean the REAL team dir (recorded in the registry), not the derived one.
    const off = await runBootstrap(['--off', '--registry', divergentRegistry])
    expect(off.code).toBe(0)
    await sleep(500)
    await expect(readFile(divergentRegistry, 'utf-8')).rejects.toThrow('ENOENT')
    await expect(readFile(join(teamsDir, realTeamDirName, 'config.json'), 'utf-8')).rejects.toThrow(
      'ENOENT',
    )
  })
})
