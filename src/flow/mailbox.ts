/**
 * Low-level mailbox I/O.
 *
 * Claude Code expects the leader inbox to be a JSON array of TeammateMessage
 * objects at ~/.claude/teams/{sanitized-team}/inboxes/team-lead.json.
 *
 * We serialize writes per inbox path (process-local) and use an atomic rename
 * so a concurrent read by CC's useInboxPoller never sees a partially written
 * array.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FlowMessage } from './types.js'

export async function readMailbox(inboxPath: string): Promise<FlowMessage[]> {
  try {
    const raw = await readFile(inboxPath, 'utf-8')
    return JSON.parse(raw) as FlowMessage[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Serialize writes to the same inbox path within this process.
 *
 * In the Flow architecture only the bridge process writes to the leader inbox,
 * so a process-local queue is sufficient to guarantee ordering and prevent
 * the read-modify-write race.
 */
class MailboxQueue {
  private pending = new Map<string, Promise<unknown>>()

  async run<T>(inboxPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.pending.get(inboxPath) ?? Promise.resolve()
    const next = prev.then(fn, fn).finally(() => {
      if (this.pending.get(inboxPath) === next) {
        this.pending.delete(inboxPath)
      }
    })
    this.pending.set(inboxPath, next)
    return next as Promise<T>
  }
}

const queue = new MailboxQueue()

export async function appendToMailbox(
  inboxPath: string,
  message: Omit<FlowMessage, 'read'>,
): Promise<void> {
  await queue.run(inboxPath, async () => {
    await mkdir(dirname(inboxPath), { recursive: true })
    const existing = await readMailbox(inboxPath)
    const next: FlowMessage = { ...message, read: false }
    await writeMailbox(inboxPath, [...existing, next])
  })
}

export async function clearMailbox(inboxPath: string): Promise<void> {
  try {
    await writeFile(inboxPath, '[]', 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function writeMailbox(inboxPath: string, messages: FlowMessage[]): Promise<void> {
  const tmp = `${inboxPath}.tmp`
  await writeFile(tmp, JSON.stringify(messages, null, 2) + '\n', 'utf-8')
  await rename(tmp, inboxPath)
}
