/**
 * Shared data types for CC Flow.
 *
 * FlowMessage mirrors the subset of CC's TeammateMessage that we inject into
 * the leader inbox, so CC's useInboxPoller can consume it without modification.
 */

export type FlowMessage = {
  from: string
  text: string
  summary?: string
  color?: string
  timestamp: string
  read: boolean
}

/**
 * Information about the project the CC session is working on.
 */
export type ProjectInfo = {
  /** Project name, preferably from package.json. */
  name: string
  /** Current working directory when cc-flow was enabled. */
  path: string
  /** Project root directory, identified by package.json or .git. */
  rootPath: string
}

/**
 * Per-session registry entry. Persisted under ~/.claude/cc-flow/.
 */
export type FlowRegistryEntry = {
  sessionId: string
  sessionShortId: string
  teamName: string
  /**
   * Absolute path of the real team directory (named by the Agent tool). Off
   * removes this directory; falling back to teamName-derivation would miss it
   * because the directory name rarely matches --team.
   */
  teamDir?: string
  port: number
  pid: number
  authToken: string
  startedAt: string
  /** Brief description of what this session is doing (<= 100 chars). */
  description: string
  /** Project context for the session. */
  project: ProjectInfo
}
