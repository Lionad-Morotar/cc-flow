import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTeamDirBySession, readTeamConfig, createTeamForSession } from '../../src/flow/team-resolve.js'

describe('team-resolve', () => {
  let teamsDir: string
  const original = process.env.CC_FLOW_TEAMS_DIR

  beforeEach(async () => {
    teamsDir = await mkdtemp(join(tmpdir(), 'ccx-resolve-teams-'))
    process.env.CC_FLOW_TEAMS_DIR = teamsDir
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.CC_FLOW_TEAMS_DIR
    else process.env.CC_FLOW_TEAMS_DIR = original
    await rm(teamsDir, { recursive: true, force: true })
  })

  async function makeTeam(dir: string, leadSessionId: string): Promise<void> {
    await mkdir(join(teamsDir, dir), { recursive: true })
    await writeFile(
      join(teamsDir, dir, 'config.json'),
      JSON.stringify({ name: dir, leadSessionId, leadAgentId: `team-lead@${dir}` }),
      'utf-8',
    )
  }

  it('finds the team directory whose leadSessionId matches', async () => {
    await makeTeam('session-aaaaaaaa', 'aaaaaaaa-1111-2222-3333-444455556666')
    await makeTeam('session-bbbbbbbb', 'bbbbbbbb-1111-2222-3333-444455556666')
    const found = await resolveTeamDirBySession('bbbbbbbb-1111-2222-3333-444455556666')
    expect(found).toBe(join(teamsDir, 'session-bbbbbbbb'))
  })

  it('returns null when no team matches the session', async () => {
    await makeTeam('session-aaaaaaaa', 'aaaaaaaa-1111-2222-3333-444455556666')
    expect(await resolveTeamDirBySession('nonexistent-session')).toBeNull()
  })

  it('returns null when the teams directory does not exist', async () => {
    process.env.CC_FLOW_TEAMS_DIR = '/nonexistent/teams/path'
    expect(await resolveTeamDirBySession('whatever')).toBeNull()
  })

  it('ignores team directories without a config.json', async () => {
    await mkdir(join(teamsDir, 'orphan-team'), { recursive: true }) // no config.json
    await makeTeam('session-real', 'real-1111-2222-3333-444455556666')
    const found = await resolveTeamDirBySession('real-1111-2222-3333-444455556666')
    expect(found).toBe(join(teamsDir, 'session-real'))
  })

  it('readTeamConfig returns null for a missing config', async () => {
    expect(await readTeamConfig(join(teamsDir, 'nope'))).toBeNull()
  })

  it('createTeamForSession creates config and leader inbox', async () => {
    const sessionId = 'create-test-1234'
    const teamDir = join(teamsDir, 'session-create-test')
    await createTeamForSession(teamDir, sessionId)

    const config = await readTeamConfig(teamDir)
    expect(config?.name).toBe('session-create-test')
    expect(config?.leadSessionId).toBe(sessionId)
    expect(config?.leadAgentId).toBe('team-lead@session-create-test')
    expect(config?.members?.[0]).toMatchObject({ name: 'team-lead', agentType: 'team-lead' })

    const inbox = JSON.parse(await readFile(join(teamDir, 'inboxes', 'team-lead.json'), 'utf-8'))
    expect(inbox).toEqual([])
  })
})
