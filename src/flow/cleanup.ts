/**
 * Flow Cleanup — invoked by the SessionEnd hook to remove resources for a
 * single CC session.
 *
 * It reads the hook input JSON from stdin, derives the registry path from the
 * session_id, and reuses the same cleanup logic as `flow-bootstrap --off`.
 */

import { rm } from 'node:fs/promises'
import { getTeamDir } from './paths.js'
import { killBridge, readRegistry } from './registry.js'

const MAX_STDIN_BYTES = 64 * 1024

type HookInput = {
  session_id?: string
}

async function readStdin(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let received = 0
    const chunks: Buffer[] = []
    process.stdin.on('data', chunk => {
      received += (chunk as Buffer).length
      if (received > MAX_STDIN_BYTES) {
        reject(new Error('stdin too large'))
        return
      }
      chunks.push(chunk as Buffer)
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as HookInput)
      } catch (err) {
        reject(new Error(`failed to parse hook input JSON: ${(err as Error).message}`))
      }
    })
    process.stdin.on('error', reject)
  })
}

async function main(): Promise<void> {
  const input = await readStdin()
  const sessionId = input.session_id
  if (!sessionId) {
    console.error('[flow-cleanup] no session_id in hook input, exiting')
    process.exit(0)
  }

  const { getFlowRegistryPath } = await import('./paths.js')
  const sessionShortId = sessionId.slice(0, 8)
  const registryPath = getFlowRegistryPath(sessionShortId)

  const entry = await readRegistry(sessionShortId, registryPath)
  if (!entry) {
    // No registry for this session — nothing to clean.
    process.exit(0)
  }

  await killBridge(entry.pid)
  await rm(entry.teamDir ?? getTeamDir(entry.teamName), { recursive: true, force: true })
  await rm(registryPath, { force: true })

  console.error(`[flow-cleanup] cleaned session ${sessionShortId}`)
}

main().catch(err => {
  console.error(`[flow-cleanup] ${err instanceof Error ? err.message : String(err)}`)
  // SessionEnd hooks cannot block; exit as soon as we log the error so CC
  // knows the cleanup failed without waiting.
  process.exit(1)
})
