import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import { getLeaderInboxPath, getTeamConfigPath, getTeamDir } from '../../src/flow/paths.js'
import { readMailbox } from '../../src/flow/mailbox.js'

const repoRoot = join(import.meta.dirname, '..', '..')
const bridgeScript = join(repoRoot, 'scripts/flow-bridge.js')

function httpRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

describe('bridge', () => {
  let teamsDir: string
  let projectRoot: string
  let teamName: string
  let token: string
  let teamConfigPath: string
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR
  const originalProjectRoot = process.env.CC_FLOW_PROJECT_ROOT

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'cc-flow-test-'))
    teamsDir = await mkdtemp(join(tmpdir(), 'ccx-teams-'))
    teamName = 'cc-flow-bridge-test'
    token = 'test-token-12345'
    process.env.CC_FLOW_PROJECT_ROOT = projectRoot
    process.env.CC_FLOW_TEAMS_DIR = teamsDir
    await mkdir(getTeamDir(teamName), { recursive: true })
    teamConfigPath = getTeamConfigPath(teamName)
    await writeFile(teamConfigPath, JSON.stringify({ name: teamName }), 'utf-8')
  })

  afterEach(async () => {
    process.env.CC_FLOW_TEAMS_DIR = originalTeamsDir
    process.env.CC_FLOW_PROJECT_ROOT = originalProjectRoot
    await rm(teamsDir, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  async function startBridge(registryPath?: string): Promise<{ port: number; child: import('node:child_process').ChildProcess }> {
    const args = [
      bridgeScript,
      '--team',
      teamName,
      '--port',
      '0',
      '--team-config-path',
      teamConfigPath,
    ]
    if (registryPath) args.push('--registry', registryPath)

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CC_FLOW_TEAMS_DIR: teamsDir,
        CC_FLOW_TOKEN: token,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      child.stderr!.on('data', chunk => {
        output += chunk.toString()
        const match = output.match(/FLOW_BRIDGE_LISTENING port=(\d+)/)
        if (match) resolve(Number(match[1]))
      })
      child.on('error', reject)
      child.on('exit', code => {
        if (code !== 0) reject(new Error(`bridge exited early with code ${code}: ${output}`))
      })
      setTimeout(() => reject(new Error(`bridge start timeout: ${output}`)), 5000)
    })

    return { port, child }
  }

  it('rejects requests without token', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/status')
      expect(res.status).toBe(401)
      expect(JSON.parse(res.body).ok).toBe(false)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('rejects requests with wrong token', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/status', {
        headers: { Authorization: 'Bearer wrong' },
      })
      expect(res.status).toBe(401)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('rejects malformed inject body', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{not json',
      })
      expect(res.status).toBe(400)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('rejects an oversized request body with 413', async () => {
    const { port, child } = await startBridge()
    try {
      // Body larger than the 110KB body cap, but the text field itself is small.
      const bigBody = JSON.stringify({ text: 'ok', padding: 'x'.repeat(120 * 1024) })
      const res = await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(bigBody)),
        },
        body: bigBody,
      })
      expect(res.status).toBe(413)
      expect(JSON.parse(res.body).ok).toBe(false)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('injects a message into the leader mailbox', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Current hour: 14:00, system load normal.',
          summary: 'hourly update',
          color: 'cyan',
          from: 'hourly-flow',
        }),
      })
      expect(res.status).toBe(200)
      const { ok, timestamp } = JSON.parse(res.body)
      expect(ok).toBe(true)
      expect(typeof timestamp).toBe('string')

      const messages = await readMailbox(getLeaderInboxPath(teamName))
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        from: 'hourly-flow',
        text: 'Current hour: 14:00, system load normal.',
        summary: 'hourly update',
        color: 'cyan',
        read: false,
      })
      expect(messages[0].timestamp).toBe(timestamp)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('reports queue length on status', async () => {
    const { port, child } = await startBridge()
    try {
      await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'one' }),
      })
      await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'two' }),
      })

      const res = await httpRequest(port, '/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.teamName).toBe(teamName)
      expect(body.port).toBe(port)
      expect(body.queueLength).toBe(2)
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('exits when team config file is deleted', async () => {
    const { port, child } = await startBridge()
    // Verify it is up.
    const status = await httpRequest(port, '/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(status.status).toBe(200)

    await rm(teamConfigPath, { force: true })

    const exitCode = await new Promise<number | null>(resolve => {
      child.on('exit', resolve)
      setTimeout(() => resolve(null), 6000)
    })
    expect(exitCode).toBe(0)
  })

  it('removes its registry file when team config is deleted', async () => {
    const registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-bridge-reg-'))
    const registryPath = join(registryDir, `${teamName}-short.json`)
    await writeFile(
      registryPath,
      JSON.stringify({ sessionId: 'test-session', sessionShortId: `${teamName}-short`, teamName }),
      'utf-8',
    )

    const { port, child } = await startBridge(registryPath)
    const status = await httpRequest(port, '/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(status.status).toBe(200)

    await rm(teamConfigPath, { force: true })

    const exitCode = await new Promise<number | null>(resolve => {
      child.on('exit', resolve)
      setTimeout(() => resolve(null), 6000)
    })
    expect(exitCode).toBe(0)

    await expect(readFile(registryPath, 'utf-8')).rejects.toThrow('ENOENT')

    await rm(registryDir, { recursive: true, force: true })
  })

  it('uses --team-dir for both config and inbox, ignoring teamName', async () => {
    // The real team directory differs from what teamName would derive.
    // The bridge must write the inbox and watch the config under --team-dir.
    const realTeamDir = join(teamsDir, 'session-realteam')
    await mkdir(join(realTeamDir, 'inboxes'), { recursive: true })
    await writeFile(
      join(realTeamDir, 'config.json'),
      JSON.stringify({ name: 'session-realteam', leadSessionId: 'real' }),
      'utf-8',
    )
    const divergentTeamName = 'cc-flow-divergent'

    const child = spawn(
      process.execPath,
      [
        bridgeScript,
        '--team',
        divergentTeamName,
        '--team-dir',
        realTeamDir,
        '--port',
        '0',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CC_FLOW_TEAMS_DIR: teamsDir, CC_FLOW_TOKEN: token },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )

    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      child.stderr!.on('data', chunk => {
        output += chunk.toString()
        const match = output.match(/FLOW_BRIDGE_LISTENING port=(\d+)/)
        if (match) resolve(Number(match[1]))
      })
      child.on('error', reject)
      child.on('exit', code => {
        if (code !== 0) reject(new Error(`bridge exited early with code ${code}: ${output}`))
      })
      setTimeout(() => reject(new Error(`bridge start timeout: ${output}`)), 5000)
    })

    try {
      const res = await httpRequest(port, '/inject', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'via team-dir' }),
      })
      expect(res.status).toBe(200)

      const messages = await readMailbox(join(realTeamDir, 'inboxes', 'team-lead.json'))
      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe('via team-dir')

      // The teamName-derived directory must NOT have received an inbox.
      await expect(
        readFile(join(teamsDir, divergentTeamName, 'inboxes', 'team-lead.json'), 'utf-8'),
      ).rejects.toThrow()

      // Deleting the real config should make the bridge exit (it watches --team-dir).
      await rm(join(realTeamDir, 'config.json'), { force: true })
      const exitCode = await new Promise<number | null>(resolve => {
        child.on('exit', resolve)
        setTimeout(() => resolve(null), 6000)
      })
      expect(exitCode).toBe(0)
    } finally {
      if (!child.killed) child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('returns empty thumb for small image (single mode)', async () => {
    const { port, child } = await startBridge()
    try {
      // 1x1 red PNG data URL — full 压缩后 ≤200KB，进入单图模式
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const res = await httpRequest(port, '/files/tmp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataUrl }),
      })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.paths.thumb).toBe('')
      expect(body.paths.full).toContain('/full.webp')
      expect(existsSync(body.paths.full)).toBe(true)

      await rm(body.paths.full.replace('/full.webp', ''), { recursive: true, force: true })
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('rejects invalid dataUrl on /files/tmp', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/files/tmp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataUrl: 'not-a-data-url' }),
      })
      expect(res.status).toBe(400)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(false)
      expect(body.error).toContain('Invalid image data URL')
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('saves text content on /files/tmp and returns path', async () => {
    const { port, child } = await startBridge()
    try {
      const res = await httpRequest(port, '/files/tmp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: '<div>big</div>', ext: 'html' }),
      })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.path).toContain('/content.html')
      expect(existsSync(body.path)).toBe(true)

      await rm(body.path.replace('/content.html', ''), { recursive: true, force: true })
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })

  it('accepts large screenshot upload over 110KB (dual mode)', async () => {
    const { port, child } = await startBridge()
    try {
      // 噪声图：base64 > 110KB，且 webp 难压缩使 full > 200KB 触发双图模式
      const width = 1200
      const height = 1200
      const raw = Buffer.alloc(width * height * 3)
      for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
      const largeBuffer = await sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer()
      const dataUrl = `data:image/png;base64,${largeBuffer.toString('base64')}`
      expect(Buffer.byteLength(dataUrl, 'utf-8')).toBeGreaterThan(110 * 1024)

      const res = await httpRequest(port, '/files/tmp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataUrl }),
      })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.paths.thumb).toContain('/thumb.webp')
      expect(body.paths.full).toContain('/full.webp')

      await rm(body.paths.full.replace('/full.webp', ''), { recursive: true, force: true })
    } finally {
      child.kill('SIGTERM')
      await sleep(500)
    }
  })
})
