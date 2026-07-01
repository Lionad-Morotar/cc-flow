/**
 * Flow Bootstrap — CLI for starting and stopping the Flow Bridge.
 *
 * In "start" mode it spawns a detached bridge process and writes a registry
 * entry so the skill can later find and clean it up.
 *
 * In "--off" mode it reads the registry, kills the bridge, removes the CC
 * team directory, and deletes the registry file.
 */

import { spawn } from 'node:child_process'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { isPidAlive, killBridge, listRegistries, readRegistry, writeRegistry } from './registry.js'
import { getTeamDir, sanitizeTeamName } from './paths.js'
import { generateToken } from './token.js'
import { resolveTeamDirBySession } from './team-resolve.js'
import { inferProjectInfo } from './project-info.js'
import type { FlowRegistryEntry } from './types.js'

const BRIDGE_BUNDLE = 'flow-bridge.js'
const MAX_DESCRIPTION_CHARS = 100

function sanitizeDescription(
  input: string | undefined,
  projectName: string,
  sessionShortId: string,
): string {
  if (!input || input.trim().length === 0) {
    return `CC session ${sessionShortId} @ ${projectName}`
  }
  const trimmed = input.trim()
  if (trimmed.length <= MAX_DESCRIPTION_CHARS) return trimmed
  return trimmed.slice(0, MAX_DESCRIPTION_CHARS)
}

function findBridgeBundle(): string {
  const bootstrapPath = process.argv[1]
  if (!bootstrapPath) throw new Error('Cannot determine bootstrap path')
  return `${dirname(bootstrapPath)}/${BRIDGE_BUNDLE}`
}

type StartArgs = {
  team: string
  port: number
  sessionId: string
  registryPath: string
  description?: string
  teamDir?: string
}

type OffArgs = {
  registryPath?: string
}

function parseArgs(argv: string[]): { mode: 'start'; args: StartArgs } | { mode: 'off'; args: OffArgs } {
  const mode = argv.includes('--off') ? 'off' : 'start'
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    if (idx < 0 || idx + 1 >= argv.length) return undefined
    const val = argv[idx + 1]
    // Defensive: a following flag should never be consumed as a value.
    if (val.startsWith('-')) return undefined
    return val
  }

  if (mode === 'off') {
    return { mode, args: { registryPath: get('--registry') } }
  }

  const team = get('--team')
  const port = Number(get('--port'))
  const sessionId = get('--session-id')
  const registryPath = get('--registry')
  const description = get('--description')
  const teamDir = get('--team-dir')

  if (!team) throw new Error('--team is required')
  if (!Number.isFinite(port)) throw new Error('--port is required')
  if (!sessionId) throw new Error('--session-id is required')
  if (sessionId.length < 8) throw new Error('--session-id must be at least 8 characters')
  if (!registryPath) throw new Error('--registry is required')

  return { mode: 'start', args: { team, port, sessionId, registryPath, description, teamDir } }
}

async function waitForReadyFile(path: string, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(path, 'utf-8')
      const port = Number(raw.trim())
      if (Number.isFinite(port)) return port
    } catch {
      // File may not exist yet.
    }
    await sleep(50)
  }
  throw new Error('Timed out waiting for bridge ready file')
}

/**
 * Resolve the bridge token: generate a fresh 256bit one by default, or honor
 * an explicit CC_FLOW_TOKEN override. Why validate the override: a leftover
 * weak value (e.g. a test fixture bleeding into the shell env) would silently
 * downgrade the entropy guarantee; reject it loudly instead.
 */
function resolveToken(): string {
  const override = process.env.CC_FLOW_TOKEN
  if (override === undefined) return generateToken()
  if (override.length < 32) {
    throw new Error(
      `CC_FLOW_TOKEN override too weak (${override.length} chars, need >= 32). ` +
        'Unset it to let bootstrap generate a 256bit token.',
    )
  }
  return override
}

async function start(args: StartArgs): Promise<void> {
  const sessionShortId = args.sessionId.slice(0, 8)
  const token = resolveToken()

  // Locate the real team directory. When the skill calls bootstrap directly it
  // can pass --team-dir explicitly; this avoids relying on leadSessionId, which
  // does not match the main session ID when the teammate was created via the
  // Agent tool (the teammate lives in a child session). If no --team-dir is
  // provided, fall back to probing by session for backwards compatibility.
  const teamDir = args.teamDir ?? await resolveTeamDirBySession(args.sessionId)
  if (!teamDir) {
    throw new Error(
      `No team directory found for session ${args.sessionId}. ` +
        'Create the placeholder teammate (via the Agent tool) before starting the Flow Bridge, or pass --team-dir explicitly.',
    )
  }

  // Idempotency: if a bridge for this session is already alive, reuse it.
  const existing = await readRegistry(sessionShortId, args.registryPath)
  if (existing && isPidAlive(existing.pid)) {
    console.log(
      `FLOW_BRIDGE_ALREADY_RUNNING port=${existing.port} pid=${existing.pid} registry=${args.registryPath}`,
    )
    return
  }

  const project = await inferProjectInfo()
  const description = sanitizeDescription(args.description, project.name, sessionShortId)

  const entry: FlowRegistryEntry = {
    sessionId: args.sessionId,
    sessionShortId,
    teamName: args.team,
    teamDir,
    port: args.port,
    pid: process.pid, // temporary, replaced after spawn
    authToken: token,
    startedAt: new Date().toISOString(),
    description,
    project,
  }

  const readyDir = await mkdtemp(join(tmpdir(), 'cc-flow-ready-'))
  const readyFile = `${readyDir}/ready`

  const bridgePath = findBridgeBundle()
  const child = spawn(
    process.execPath,
    [
      bridgePath,
      '--team',
      args.team,
      '--team-dir',
      teamDir,
      '--port',
      String(args.port),
      '--ready-file',
      readyFile,
      '--registry',
      args.registryPath,
    ],
    {
      detached: true,
      stdio: 'ignore',
      // Pass the token via env, not argv, so it never appears in
      // /proc/<pid>/cmdline (which is world-readable on Linux) or ps output.
      env: { ...process.env, CC_FLOW_TOKEN: token },
    },
  )
  child.unref()

  if (child.pid === undefined) {
    throw new Error('Failed to spawn Flow Bridge process: no pid assigned')
  }
  entry.pid = child.pid

  // Wait for the bridge to bind so we can store the actual port (important when port=0).
  // If the child fails to spawn or exits before signaling ready, surface that error instead of timing out.
  const spawnError = new Promise<never>((_, reject) => {
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== 0) reject(new Error(`Bridge process exited with code ${code}`))
    })
  })
  const actualPort = await Promise.race([waitForReadyFile(readyFile), spawnError])
  entry.port = actualPort

  // Best-effort cleanup of the temporary ready directory.
  await rm(readyDir, { recursive: true, force: true })

  await writeRegistry(entry, args.registryPath)

  console.log(
    `FLOW_BRIDGE_STARTED port=${entry.port} pid=${entry.pid} registry=${args.registryPath}`,
  )
}

async function off(args: OffArgs): Promise<void> {
  const targets: Array<{ path: string; entry: FlowRegistryEntry }> = []

  if (args.registryPath) {
    const shortId = basename(args.registryPath, '.json')
    const entry = await readRegistry(shortId, args.registryPath)
    if (entry) targets.push({ path: args.registryPath, entry })
  } else {
    targets.push(...(await listRegistries()))
  }

  if (targets.length === 0) {
    console.log('FLOW_OFF: no active Flow sessions found')
    return
  }

  const results: Array<{ teamName: string; killed: boolean }> = []
  for (const { path, entry } of targets) {
    if (!isTrustedRegistryEntry(entry)) {
      console.error(
        `[flow-bootstrap] skipping untrusted registry entry ${path}: teamName=${entry.teamName}`,
      )
      continue
    }

    const killed = await killBridge(entry.pid)
    await rm(entry.teamDir ?? getTeamDir(entry.teamName), { recursive: true, force: true })
    await rm(path, { force: true })
    results.push({ teamName: entry.teamName, killed })
  }

  console.log(`FLOW_OFF: cleaned ${results.length} session(s)`)
  for (const r of results) {
    console.log(`  - ${r.teamName} (killed=${r.killed})`)
  }
}

function isTrustedRegistryEntry(entry: FlowRegistryEntry): boolean {
  if (!entry.teamName || typeof entry.teamName !== 'string') return false
  if (!entry.teamName.startsWith('cc-flow-')) return false
  // Defense in depth: reject names that contain path separators or unusual
  // characters, even though cc-flow itself only generates sanitized names.
  if (sanitizeTeamName(entry.teamName) !== entry.teamName) return false
  if (entry.sessionShortId !== entry.sessionId.slice(0, 8)) return false
  return true
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv)
  if (parsed.mode === 'start') {
    await start(parsed.args)
  } else {
    await off(parsed.args)
  }
}

main(process.argv).catch(err => {
  console.error(`[flow-bootstrap] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
