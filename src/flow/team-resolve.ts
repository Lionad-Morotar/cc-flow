/**
 * Locate the on-disk team directory for a CC session.
 *
 * Why this exists: the Agent tool creates the team directory and names it
 * itself (observed as `session-<shortId>`), and that directory name is NOT the
 * `--team` value we pass when spawning the bridge. Deriving the directory from
 * the team name would therefore point at the wrong place. Instead we scan each
 * config.json under the teams directory and match on the stable leadSessionId
 * field, so we track CC's directory layout without depending on its private
 * naming convention.
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { getTeamsDir } from './paths.js'

export type TeamConfig = {
  name?: string
  leadSessionId?: string
  leadAgentId?: string
  members?: Array<Record<string, unknown>>
  createdAt?: number
}

export async function readTeamConfig(teamDir: string): Promise<TeamConfig | null> {
  try {
    const raw = await readFile(join(teamDir, 'config.json'), 'utf-8')
    return JSON.parse(raw) as TeamConfig
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Returns the absolute team directory whose leader session is `sessionId`,
 * or null if no such team exists.
 */
export async function resolveTeamDirBySession(sessionId: string): Promise<string | null> {
  const teamsDir = getTeamsDir()
  let names: string[]
  try {
    names = await readdir(teamsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  for (const name of names) {
    const teamDir = join(teamsDir, name)
    const config = await readTeamConfig(teamDir)
    if (config?.leadSessionId === sessionId) return teamDir
  }
  return null
}

/**
 * Returns the absolute team directory that contains a member with the given
 * agent name, preferring the most recently joined one, or null if no such team
 * exists.
 *
 * Why this exists: in current Claude Code versions the `Agent` tool creates a
 * subagent in its own child-session team (e.g. `session-<childShortId>`). The
 * main session polls that team's `team-lead.json` inbox, so the bridge must
 * write there rather than to a main-session team directory. When multiple stale
 * teams still have a `cc-flow-bridge` member, we pick the newest one.
 */
export async function resolveTeamDirByMember(agentName: string): Promise<string | null> {
  const teamsDir = getTeamsDir()
  let names: string[]
  try {
    names = await readdir(teamsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let bestDir: string | null = null
  let bestJoinedAt = -1

  for (const name of names) {
    const teamDir = join(teamsDir, name)
    const config = await readTeamConfig(teamDir)
    const member = config?.members?.find((m: Record<string, unknown>) => m.name === agentName)
    if (!member) continue

    const joinedAt = typeof member.joinedAt === 'number' ? member.joinedAt : 0
    if (joinedAt > bestJoinedAt) {
      bestJoinedAt = joinedAt
      bestDir = teamDir
    }
  }
  return bestDir
}

/**
 * Create a minimal team directory for the given lead session.
 *
 * Why this exists: in current Claude Code versions the Agent tool spawns a
 * subagent in its own child session team, so the main session never gets a
 * team directory automatically. The bridge needs a leader inbox that the main
 * session can poll, so we create one ourselves when CC hasn't done it.
 *
 * The directory layout matches CC's own format so that if/when CC discovers
 * the directory it will treat it as a valid team.
 */
export async function createTeamForSession(
  teamDir: string,
  sessionId: string,
): Promise<void> {
  const name = basename(teamDir)
  const config: TeamConfig = {
    name,
    createdAt: Date.now(),
    leadAgentId: `team-lead@${name}`,
    leadSessionId: sessionId,
    members: [
      {
        agentId: `team-lead@${name}`,
        name: 'team-lead',
        agentType: 'team-lead',
        joinedAt: Date.now(),
        tmuxPaneId: 'leader',
        cwd: process.cwd(),
        subscriptions: [],
        backendType: 'in-process',
      },
    ],
  }

  await mkdir(join(teamDir, 'inboxes'), { recursive: true })
  await writeFile(join(teamDir, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')
  await writeFile(join(teamDir, 'inboxes', 'team-lead.json'), '[]\n', 'utf-8')
}
