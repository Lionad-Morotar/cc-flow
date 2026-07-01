/**
 * Flow registry: per-session bookkeeping for the bridge process.
 *
 * Keeps track of which bridge belongs to which CC session so that:
 * - the same session can re-enable Flow idempotently
 * - `cc-flow --off` can kill the bridge and remove the team directory
 *
 * Every function takes an optional explicit `registryPath`/`registryDir`. When
 * omitted it falls back to the default location under ~/.claude/cc-flow. This
 * lets bootstrap honor a caller-supplied `--registry` path end-to-end (write,
 * read, list, clean) instead of silently diverging from it.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { getFlowRegistryDir, getFlowRegistryPath, getTeamDir } from './paths.js'
import type { FlowRegistryEntry } from './types.js'

export async function ensureRegistryDir(registryPath?: string): Promise<void> {
  await mkdir(registryPath ? dirname(registryPath) : getFlowRegistryDir(), {
    recursive: true,
    mode: 0o700,
  })
}

export async function readRegistry(
  sessionShortId: string,
  registryPath?: string,
): Promise<FlowRegistryEntry | null> {
  const path = registryPath ?? getFlowRegistryPath(sessionShortId)
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as FlowRegistryEntry
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeRegistry(
  entry: FlowRegistryEntry,
  registryPath?: string,
): Promise<void> {
  const path = registryPath ?? getFlowRegistryPath(entry.sessionShortId)
  // Directory 0700 keeps other uids from listing the registry directory.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  // File 0600 so only the owner can read the plaintext token. 0o600 is
  // already minimal (no group/other bits), so any umask only removes bits it
  // already lacks — the effective mode is stable regardless of process umask.
  await writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  })
  await rename(tmp, path)
}

export async function listRegistries(
  registryDir?: string,
): Promise<Array<{ path: string; entry: FlowRegistryEntry }>> {
  const dir = registryDir ?? getFlowRegistryDir()
  try {
    const names = await readdir(dir)
    const results: Array<{ path: string; entry: FlowRegistryEntry }> = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const fullPath = `${dir}/${name}`
      try {
        const raw = await readFile(fullPath, 'utf-8')
        results.push({ path: fullPath, entry: JSON.parse(raw) as FlowRegistryEntry })
      } catch {
        // Ignore malformed registry files during listing.
      }
    }
    return results
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Best-effort check that a process is still running.
 * Signal 0 does not send a real signal; it only checks whether the pid exists.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Ask a bridge process to exit, escalating from SIGTERM to SIGKILL.
 */
export async function killBridge(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) return true
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !isPidAlive(pid)
  }

  for (let i = 0; i < 20; i++) {
    await setTimeout(100)
    if (!isPidAlive(pid)) return true
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Process may have exited between check and kill.
  }
  return !isPidAlive(pid)
}

/**
 * Clean up everything cc-expand manages for a single Flow session.
 */
export async function cleanupByRegistry(
  entry: FlowRegistryEntry,
  registryPath?: string,
): Promise<void> {
  await killBridge(entry.pid)
  await rm(entry.teamDir ?? getTeamDir(entry.teamName), { recursive: true, force: true })
  const path = registryPath ?? getFlowRegistryPath(entry.sessionShortId)
  await rm(path, { force: true })
}
