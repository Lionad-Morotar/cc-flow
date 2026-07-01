/**
 * cc-flow MCP Server
 *
 * Exposes two tools:
 * - `list`: discover active cc-flow sessions from the registry.
 * - `send`: inject context into a specific session's Flow Bridge.
 *
 * The server communicates over stdio and is spawned by Claude Code for each
 * conversation. It has no long-lived state of its own.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { request } from 'node:http'
import { access, constants } from 'node:fs/promises'
import { listRegistries, readRegistry, isPidAlive } from '../flow/registry.js'
import { getFlowRegistryDir } from '../flow/paths.js'
import type { FlowRegistryEntry } from '../flow/types.js'

declare const __CC_FLOW_VERSION__: string | undefined
const packageVersion = typeof __CC_FLOW_VERSION__ !== 'undefined' ? __CC_FLOW_VERSION__ : '0.1.1'
const MAX_SEND_TEXT_BYTES = 20 * 1024

const SessionEntrySchema = z.object({
  sessionShortId: z.string(),
  description: z.string(),
  project: z.object({
    name: z.string(),
    path: z.string(),
    rootPath: z.string(),
  }),
  startedAt: z.string(),
  port: z.number(),
  pid: z.number(),
})

type SessionEntry = z.infer<typeof SessionEntrySchema>

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isRegistryEntryAlive(entry: FlowRegistryEntry): Promise<boolean> {
  if (!isPidAlive(entry.pid)) return false
  if (entry.teamDir) {
    return directoryExists(entry.teamDir)
  }
  return true
}

async function listSessions(): Promise<SessionEntry[]> {
  const all = await listRegistries(getFlowRegistryDir())
  const results: SessionEntry[] = []
  for (const { entry } of all) {
    if (!(await isRegistryEntryAlive(entry))) continue
    results.push({
      sessionShortId: entry.sessionShortId,
      description: entry.description,
      project: entry.project,
      startedAt: entry.startedAt,
      port: entry.port,
      pid: entry.pid,
    })
  }
  return results
}

async function inject(
  entry: FlowRegistryEntry,
  text: string,
  from?: string,
): Promise<{ ok: true; timestamp: string } | { ok: false; error: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ text, from })
    const req = request(
      {
        hostname: '127.0.0.1',
        port: entry.port,
        path: '/inject',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${entry.authToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          try {
            const body = JSON.parse(data) as Record<string, unknown>
            if (res.statusCode === 200 && body.ok === true) {
              resolve({ ok: true, timestamp: String(body.timestamp) })
            } else {
              resolve({ ok: false, error: String(body.error ?? 'bridge rejected request') })
            }
          } catch {
            resolve({ ok: false, error: `bridge returned non-JSON: ${data}` })
          }
        })
      },
    )
    req.on('error', () => reject(new Error('Failed to connect to bridge')))
    req.write(payload)
    req.end()
  })
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'cc-flow-mcp-server',
    version: packageVersion,
  })

  server.registerTool(
    'list',
    {
      title: 'List cc-flow sessions',
      description:
        'List all active cc-flow sessions that can receive context. Returns session short ID, description, and project information.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const sessions = await listSessions()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ sessions }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    'send',
    {
      title: 'Send context to a cc-flow session',
      description:
        'Send a text context message to a specific cc-flow session identified by its sessionShortId.',
      inputSchema: z.object({
        sessionShortId: z.string().describe('Short ID of the target session'),
        text: z.string().describe('Context text to inject'),
        from: z.string().optional().describe('Identifier of the sender'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async params => {
      if (Buffer.byteLength(params.text, 'utf-8') > MAX_SEND_TEXT_BYTES) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'text exceeds 20KB limit' }),
            },
          ],
        }
      }

      const entry = await readRegistry(params.sessionShortId)
      if (!entry) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'session not found' }),
            },
          ],
        }
      }

      if (!(await isRegistryEntryAlive(entry))) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'session is no longer active' }),
            },
          ],
        }
      }

      try {
        const result = await inject(entry, params.text, params.from)
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        }
      }
    },
  )

  return server
}

async function main(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error(`[cc-flow-mcp] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
