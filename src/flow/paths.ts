/**
 * Path conventions for CC Flow.
 *
 * These deliberately mirror the directory layout used by Claude Code's own
 * teammate/swarm code so that the external bridge can write to the same
 * mailbox files that CC reads. The env-var fallbacks exist only for tests.
 *
 * Why the registry lives under ~/.claude/cc-flow rather than <project-root>/.tmp:
 * earlier versions derived it from the project root, but when a session runs
 * with cwd at the user's home (where ~/.tmp is a regular file, not a directory),
 * mkdir -p silently fails and bootstrap cannot persist anything. The registry
 * is CC-scoped state, so it belongs with the rest of ~/.claude.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Explicit project root override. Kept as a narrow opt-in — the registry no
 * longer derives from it — so callers that genuinely need a project root can
 * still ask for one without dragging the registry location along.
 */
export function getProjectRoot(): string {
  return process.env.CC_FLOW_PROJECT_ROOT ?? process.cwd()
}

export function getFlowRegistryDir(): string {
  return process.env.CC_FLOW_REGISTRY_DIR ?? join(homedir(), '.claude', 'cc-flow')
}

export function getFlowRegistryPath(sessionShortId: string): string {
  return join(getFlowRegistryDir(), `${sessionShortId}.json`)
}

/**
 * Mirrors CC's sanitizeName: non-alphanumeric characters become hyphens.
 * This determines the directory name under ~/.claude/teams.
 */
export function sanitizeTeamName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}

export function getTeamsDir(): string {
  return process.env.CC_FLOW_TEAMS_DIR ?? join(homedir(), '.claude', 'teams')
}

export function getTeamDir(teamName: string): string {
  return join(getTeamsDir(), sanitizeTeamName(teamName))
}

export function getTeamConfigPath(teamName: string): string {
  return join(getTeamDir(teamName), 'config.json')
}

export function getLeaderInboxPath(teamName: string): string {
  return join(getTeamDir(teamName), 'inboxes', 'team-lead.json')
}
