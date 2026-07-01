/**
 * Flow Bridge — local HTTP server that receives messages from an external
 * Flow process and appends them to the CC leader's mailbox.
 *
 * Security constraints:
 * - binds only to 127.0.0.1
 * - requires Bearer token on every route
 * - validates input (text required, max 100KB)
 * - rejects request bodies larger than 110KB
 *
 * Lifecycle:
 * - polls the team config file every 2s; if CC cleans it up, exit cleanly.
 */

import { createServer, type Server } from 'node:http'
import { access, constants, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setInterval, clearInterval } from 'node:timers'
import { appendToMailbox, readMailbox } from './mailbox.js'
import { getLeaderInboxPath, getTeamConfigPath } from './paths.js'
import { saveScreenshot, saveTextFile } from './tmp-files.js'
import { safeCompare } from './token.js'
import type { FlowMessage } from './types.js'
import { rm as removeDir } from 'node:fs/promises'
import { tmpFilesDir } from './tmp-files.js'

const MAX_TEXT_BYTES = 100 * 1024
const MAX_BODY_BYTES = 110 * 1024
const MAX_TMP_BODY_BYTES = 8 * 1024 * 1024

class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large')
  }
}

type BridgeConfig = {
  teamName: string
  port: number
  token: string
  teamDir?: string
  teamConfigPath?: string
  readyFile?: string
  registryPath?: string
}

function parseArgs(argv: string[]): BridgeConfig {
  let teamName: string | undefined
  let port: number | undefined
  let teamDir: string | undefined
  let teamConfigPath: string | undefined
  let readyFile: string | undefined
  let registryPath: string | undefined

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--team':
        teamName = argv[++i]
        break
      case '--port':
        port = Number(argv[++i])
        break
      case '--team-dir':
        teamDir = argv[++i]
        break
      case '--team-config-path':
        teamConfigPath = argv[++i]
        break
      case '--ready-file':
        readyFile = argv[++i]
        break
      case '--registry':
        registryPath = argv[++i]
        break
    }
  }

  const token = process.env.CC_FLOW_TOKEN
  // Clear the secret from environ so it does not linger in
  // /proc/<pid>/environ for the bridge's lifetime; it is captured in the
  // local config already.
  delete process.env.CC_FLOW_TOKEN
  if (!teamName) throw new Error('--team is required')
  if (!token) throw new Error('CC_FLOW_TOKEN env is required')
  if (port == null || Number.isNaN(port)) throw new Error('--port is required')

  return { teamName, port, token, teamDir, teamConfigPath, readyFile, registryPath }
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function collectBody(req: import('node:http').IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = 0
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      received += (chunk as Buffer).length
      if (received > maxBytes) {
        reject(new PayloadTooLargeError())
        return
      }
      chunks.push(chunk as Buffer)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export function startBridge(config: BridgeConfig): Server {
  // Prefer the explicit team directory for both the mailbox and the watched
  // config. The teamName-derived path is only a fallback: the Agent tool names
  // the team directory itself, so it rarely matches the --team value.
  const inboxPath = config.teamDir
    ? join(config.teamDir, 'inboxes', 'team-lead.json')
    : getLeaderInboxPath(config.teamName)
  const teamConfigPath =
    config.teamConfigPath ??
    (config.teamDir ? join(config.teamDir, 'config.json') : getTeamConfigPath(config.teamName))

  const server = createServer(async (req, res) => {
    // Enforce localhost only (binding below already does, but defense in depth).
    const remote = req.socket.remoteAddress
    if (!remote || (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1')) {
      sendJson(res, 403, { ok: false, error: 'Forbidden: localhost only' })
      return
    }

    const auth = req.headers['authorization'] ?? ''
    const credential = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!credential || !safeCompare(credential, config.token)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }

    const url = req.url ?? ''
    const method = req.method ?? 'GET'

    try {
      if (method === 'POST' && url === '/inject') {
        const raw = await collectBody(req, MAX_BODY_BYTES)
        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
          return
        }

        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { ok: false, error: 'Body must be an object' })
          return
        }
        const { text, summary, color, from } = body as Record<string, unknown>

        if (typeof text !== 'string' || text.length === 0) {
          sendJson(res, 400, { ok: false, error: 'text is required and must be a non-empty string' })
          return
        }
        if (Buffer.byteLength(text, 'utf-8') > MAX_TEXT_BYTES) {
          sendJson(res, 413, { ok: false, error: 'text exceeds 100KB limit' })
          return
        }

        const message: Omit<FlowMessage, 'read'> = {
          from: typeof from === 'string' && from.length > 0 ? from : 'flow',
          text,
          summary: typeof summary === 'string' ? summary : undefined,
          color: typeof color === 'string' ? color : undefined,
          timestamp: new Date().toISOString(),
        }

        await appendToMailbox(inboxPath, message)
        sendJson(res, 200, { ok: true, timestamp: message.timestamp })
        return
      }

      if (method === 'POST' && url === '/files/tmp') {
        const raw = await collectBody(req, MAX_TMP_BODY_BYTES)
        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
          return
        }

        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { ok: false, error: 'Body must be an object' })
          return
        }
        const { dataUrl, content, ext } = body as Record<string, unknown>

        try {
          // 图片：dataUrl → thumb/full webp
          if (typeof dataUrl === 'string' && dataUrl.length > 0) {
            const paths = await saveScreenshot(dataUrl)
            sendJson(res, 200, { ok: true, paths })
            return
          }
          // 文本：content → 单文件路径（如过大的 outerHTML）
          if (typeof content === 'string') {
            const path = await saveTextFile(content, typeof ext === 'string' ? ext : 'txt')
            sendJson(res, 200, { ok: true, path })
            return
          }
          sendJson(res, 400, { ok: false, error: 'dataUrl or content is required' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 400, { ok: false, error: message })
        }
        return
      }

      if (method === 'GET' && url === '/status') {
        const messages = await readMailbox(inboxPath)
        const unread = messages.filter(m => !m.read).length
        sendJson(res, 200, {
          ok: true,
          teamName: config.teamName,
          port: (server.address() as import('node:net').AddressInfo).port,
          queueLength: unread,
        })
        return
      }

      sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { ok: false, error: 'Payload too large' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[flow-bridge] request error: ${message}`)
      sendJson(res, 500, { ok: false, error: 'Internal error' })
    }
  })

  server.on('error', err => {
    console.error(`[flow-bridge] server error: ${err.message}`)
    process.exit(1)
  })

  const lifecycle = setInterval(() => {
    void (async () => {
      try {
        await access(teamConfigPath, constants.F_OK)
      } catch {
        console.error('[flow-bridge] team config gone, exiting')
        clearInterval(lifecycle)
        // Best-effort cleanup of screenshot tmp files.
        try {
          await removeDir(tmpFilesDir, { recursive: true, force: true })
        } catch (err) {
          console.error(`[flow-bridge] failed to remove tmp files: ${(err as Error).message}`)
        }
        // Best-effort cleanup of our registry entry so stale sessions don't
        // accumulate when the SessionEnd hook fails to run.
        if (config.registryPath) {
          try {
            await rm(config.registryPath, { force: true })
          } catch (err) {
            console.error(`[flow-bridge] failed to remove registry: ${(err as Error).message}`)
          }
        }
        server.close(() => process.exit(0))
        // If close stalls, force exit after 2s.
        setTimeout(() => process.exit(0), 2000).unref()
      }
    })().catch(err => {
      console.error(`[flow-bridge] lifecycle error: ${(err as Error).message}`)
      clearInterval(lifecycle)
      process.exit(1)
    })
  }, 2000)

  server.listen(config.port, '127.0.0.1', async () => {
    const address = server.address() as import('node:net').AddressInfo
    console.error(`FLOW_BRIDGE_LISTENING port=${address.port}`)
    if (config.readyFile) {
      try {
        await writeFile(config.readyFile, String(address.port), 'utf-8')
      } catch (err) {
        console.error(`[flow-bridge] failed to write ready file: ${(err as Error).message}`)
      }
    }
  })

  return server
}

if (process.argv[1]?.endsWith('flow-bridge.js') || process.argv[1]?.endsWith('flow-bridge')) {
  const config = parseArgs(process.argv)
  startBridge(config)
}
