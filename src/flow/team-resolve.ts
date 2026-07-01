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

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getTeamsDir } from './paths.js'

export type TeamConfig = {
  name?: string
  leadSessionId?: string
  leadAgentId?: string
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
