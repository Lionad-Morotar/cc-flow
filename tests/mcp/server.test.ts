import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../../src/mcp/server.js'
import { writeRegistry } from '../../src/flow/registry.js'
import { getTeamDir } from '../../src/flow/paths.js'
import type { FlowRegistryEntry } from '../../src/flow/types.js'

const repoRoot = join(import.meta.dirname, '..', '..')

describe('mcp server', () => {
  let registryDir: string
  let teamsDir: string
  const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    registryDir = await mkdtemp(join(tmpdir(), 'cc-flow-mcp-reg-'))
    teamsDir = await mkdtemp(join(tmpdir(), 'cc-flow-mcp-teams-'))
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

  async function createClient() {
    const server = createMcpServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)
    return client
  }

  async function writeAliveSession(
    sessionId: string,
    overrides?: Partial<FlowRegistryEntry>,
  ): Promise<{ sessionShortId: string; entry: FlowRegistryEntry }> {
    const sessionShortId = sessionId.slice(0, 8)
    const teamName = `cc-flow-mcp-${sessionShortId}`
    const teamDir = getTeamDir(teamName)
    await mkdir(teamDir, { recursive: true })

    // Spawn a long-lived child to act as the bridge pid.
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
      port: 0,
      pid: sleeper.pid!,
      authToken: 'mcp-test-token',
      startedAt: new Date().toISOString(),
      description: 'mcp test session',
      project: { name: 'mcp-test', path: '/tmp/mcp-test', rootPath: '/tmp/mcp-test' },
      ...overrides,
    }
    await writeRegistry(entry)
    return { sessionShortId, entry }
  }

  it('lists active sessions', async () => {
    const { sessionShortId } = await writeAliveSession('mcp-list-session')

    const client = await createClient()
    const result = await client.callTool({
      name: 'list',
      arguments: {},
    })

    const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
    expect(text).toBeDefined()
    const parsed = JSON.parse(text!) as { sessions: Array<Record<string, unknown>> }
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0].sessionShortId).toBe(sessionShortId)
    expect(parsed.sessions[0].description).toBe('mcp test session')
  })

  it('filters stale sessions from the list', async () => {
    // One alive session.
    await writeAliveSession('mcp-alive-session')

    // One stale session: teamDir missing.
    const staleSessionId = 'mcp-stale-session'
    const staleShortId = staleSessionId.slice(0, 8)
    const staleEntry: FlowRegistryEntry = {
      sessionId: staleSessionId,
      sessionShortId: staleShortId,
      teamName: `cc-flow-mcp-${staleShortId}`,
      teamDir: join(teamsDir, 'does-not-exist'),
      port: 0,
      pid: process.pid,
      authToken: 'stale',
      startedAt: new Date().toISOString(),
      description: 'stale',
      project: { name: 'stale', path: '/tmp/stale', rootPath: '/tmp/stale' },
    }
    await writeRegistry(staleEntry)

    const client = await createClient()
    const result = await client.callTool({
      name: 'list',
      arguments: {},
    })

    const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
    const parsed = JSON.parse(text!) as { sessions: Array<Record<string, unknown>> }
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0].sessionShortId).toBe('mcp-aliv')
  })

  it('rejects send when text exceeds 20KB', async () => {
    const client = await createClient()
    const result = await client.callTool({
      name: 'send',
      arguments: {
        sessionShortId: 'any',
        text: 'x'.repeat(25 * 1024),
      },
    })

    const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
    const parsed = JSON.parse(text!) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('20KB')
  })

  it('rejects send for non-existent session', async () => {
    const client = await createClient()
    const result = await client.callTool({
      name: 'send',
      arguments: {
        sessionShortId: 'no-such',
        text: 'hello',
      },
    })

    const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
    const parsed = JSON.parse(text!) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('not found')
  })

  it('does not leak the authToken when send fails to connect', async () => {
    const sessionId = 'mcp-leak-session'
    const sessionShortId = sessionId.slice(0, 8)
    const secretToken = 'super-secret-token-must-not-appear-in-errors'
    const entry: FlowRegistryEntry = {
      sessionId,
      sessionShortId,
      teamName: `cc-flow-mcp-${sessionShortId}`,
      port: 65535,
      pid: process.pid,
      authToken: secretToken,
      startedAt: new Date().toISOString(),
      description: 'leak test',
      project: { name: 'leak-test', path: '/tmp/leak-test', rootPath: '/tmp/leak-test' },
    }
    await writeRegistry(entry)

    const client = await createClient()
    const result = await client.callTool({
      name: 'send',
      arguments: { sessionShortId, text: 'hello' },
    })

    const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
    const parsed = JSON.parse(text!) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('Failed to connect to bridge')
    expect(text!).not.toContain(secretToken)
  })

  it('sends context to a session bridge', async () => {
    // Start a real bridge for the target session.
    const sessionId = 'mcp-send-session'
    const sessionShortId = sessionId.slice(0, 8)
    const teamName = `cc-flow-mcp-${sessionShortId}`
    const teamDir = getTeamDir(teamName)
    await mkdir(teamDir, { recursive: true })
    await writeFile(
      join(teamDir, 'config.json'),
      JSON.stringify({ name: teamName, leadSessionId: sessionId }),
      'utf-8',
    )

    const token = 'mcp-send-token'
    const bridgeChild = spawn(
      process.execPath,
      [
        join(repoRoot, 'scripts/flow-bridge.js'),
        '--team',
        teamName,
        '--team-dir',
        teamDir,
        '--port',
        '0',
      ],
      {
        env: { ...process.env, CC_FLOW_TEAMS_DIR: teamsDir, CC_FLOW_TOKEN: token },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )

    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      bridgeChild.stderr!.on('data', chunk => {
        output += chunk.toString()
        const match = output.match(/FLOW_BRIDGE_LISTENING port=(\d+)/)
        if (match) resolve(Number(match[1]))
      })
      bridgeChild.on('error', reject)
      bridgeChild.on('exit', code => {
        if (code !== 0) reject(new Error(`bridge exited early: ${output}`))
      })
      setTimeout(() => reject(new Error(`bridge start timeout: ${output}`)), 5000)
    })

    const entry: FlowRegistryEntry = {
      sessionId,
      sessionShortId,
      teamName,
      teamDir,
      port,
      pid: bridgeChild.pid!,
      authToken: token,
      startedAt: new Date().toISOString(),
      description: 'send target',
      project: { name: 'send-test', path: '/tmp/send-test', rootPath: '/tmp/send-test' },
    }
    await writeRegistry(entry)

    try {
      const client = await createClient()
      const result = await client.callTool({
        name: 'send',
        arguments: {
          sessionShortId,
          text: 'hello from mcp',
          from: 'mcp-test',
        },
      })

      const text = (result.content as Array<{ type: string; text: string }>).find(c => c.type === 'text')?.text
      const parsed = JSON.parse(text!) as { ok: boolean; timestamp?: string }
      expect(parsed.ok).toBe(true)
      expect(typeof parsed.timestamp).toBe('string')
    } finally {
      bridgeChild.kill('SIGTERM')
      await sleep(500)
    }
  })
})
