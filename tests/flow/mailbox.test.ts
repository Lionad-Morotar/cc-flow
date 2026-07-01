import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendToMailbox, clearMailbox, readMailbox } from '../../src/flow/mailbox.js'
import { getLeaderInboxPath } from '../../src/flow/paths.js'

describe('mailbox', () => {
  let teamsDir: string
  let teamName: string
  const originalTeamsDir = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    teamsDir = await mkdtemp(join(tmpdir(), 'ccx-teams-'))
    teamName = 'test-team'
    process.env.CC_FLOW_TEAMS_DIR = teamsDir
  })

  afterEach(async () => {
    process.env.CC_FLOW_TEAMS_DIR = originalTeamsDir
    await rm(teamsDir, { recursive: true, force: true })
  })

  it('returns an empty array when inbox is missing', async () => {
    const inbox = getLeaderInboxPath(teamName)
    const messages = await readMailbox(inbox)
    expect(messages).toEqual([])
  })

  it('appends messages with read: false', async () => {
    const inbox = getLeaderInboxPath(teamName)
    await appendToMailbox(inbox, {
      from: 'flow',
      text: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    const messages = await readMailbox(inbox)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      from: 'flow',
      text: 'hello',
      read: false,
      timestamp: '2024-01-01T00:00:00.000Z',
    })
  })

  it('preserves optional summary and color', async () => {
    const inbox = getLeaderInboxPath(teamName)
    await appendToMailbox(inbox, {
      from: 'flow',
      text: 'hello',
      summary: 'short summary',
      color: 'cyan',
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    const messages = await readMailbox(inbox)
    expect(messages[0]).toMatchObject({
      summary: 'short summary',
      color: 'cyan',
      read: false,
    })
  })

  it('clears an existing inbox', async () => {
    const inbox = getLeaderInboxPath(teamName)
    await appendToMailbox(inbox, { from: 'flow', text: 'hello', timestamp: '2024-01-01T00:00:00.000Z' })
    await clearMailbox(inbox)
    const messages = await readMailbox(inbox)
    expect(messages).toEqual([])
  })

  it('atomically appends multiple messages', async () => {
    const inbox = getLeaderInboxPath(teamName)
    await Promise.all([
      appendToMailbox(inbox, { from: 'a', text: '1', timestamp: '2024-01-01T00:00:00.000Z' }),
      appendToMailbox(inbox, { from: 'b', text: '2', timestamp: '2024-01-01T00:00:00.000Z' }),
      appendToMailbox(inbox, { from: 'c', text: '3', timestamp: '2024-01-01T00:00:00.000Z' }),
    ])
    const messages = await readMailbox(inbox)
    expect(messages).toHaveLength(3)
    expect(messages.map(m => m.text).sort()).toEqual(['1', '2', '3'])
  })
})
