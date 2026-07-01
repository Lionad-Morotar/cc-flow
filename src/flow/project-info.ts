/**
 * Project information inference.
 *
 * When a user enables cc-flow in a CC session, we want to record which project
 * that session is working on. This helps other sessions identify the right
 * target when sending context via the MCP server.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'

export type ProjectInfo = {
  /** Project name, preferably from package.json. */
  name: string
  /** Current working directory when cc-flow was enabled. */
  path: string
  /** Project root directory, identified by package.json or .git. */
  rootPath: string
}

async function findProjectRoot(startDir: string): Promise<string> {
  let current = startDir
  while (true) {
    const markers = await Promise.all([
      fileExists(join(current, 'package.json')),
      directoryExists(join(current, '.git')),
    ])
    if (markers[0] || markers[1]) return current

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return startDir
}

async function readPackageName(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    return typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : undefined
  } catch {
    return undefined
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

/**
 * Infer project information from the current working directory.
 *
 * Why cwd: the skill runs inside CC, and the bootstrap process inherits CC's
 * current working directory. That is the most reliable project indicator we
 * have without asking the user.
 *
 * Why realpath: macOS resolves /var to /private/var through symlinks; using
 * realpath keeps tests and runtime behavior consistent.
 */
export async function inferProjectInfo(): Promise<ProjectInfo> {
  const path = await realpath(process.cwd())
  const rootPath = await findProjectRoot(path)
  // A directory is only treated as a Node project for naming purposes if it has
  // a package.json and is not the user's home directory. The home directory
  // often contains incidental package.json files (dotfiles tooling, etc.) and
  // should not be labeled as a project.
  const isNodeProject =
    (await fileExists(join(rootPath, 'package.json'))) && rootPath !== homedir()
  const name = isNodeProject ? (await readPackageName(rootPath)) ?? rootPath : rootPath
  return { name, path, rootPath }
}
