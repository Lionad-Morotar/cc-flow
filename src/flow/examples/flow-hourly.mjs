#!/usr/bin/env node
/**
 * MVP Flow example: 每小时整点报时。
 *
 * Usage:
 *   node src/flow/examples/flow-hourly.mjs <PORT> <TOKEN>
 */

import { request } from 'node:http'

const port = Number(process.argv[2])
const token = process.argv[3]

if (!Number.isFinite(port) || !token) {
  console.error('Usage: node src/flow/examples/flow-hourly.mjs <PORT> <TOKEN>')
  process.exit(1)
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
function post(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, from: 'hourly-flow', summary: '整点报时' })
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/inject',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve()
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function tick() {
  const now = new Date()
  const text = `整点报时：当前时间 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  await post(text)
  console.log(`sent: ${text}`)
}

function msUntilNextHour() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0)
  return next.getTime() - now.getTime()
}

/** @type {NodeJS.Timeout | null} */
let timer = null
let running = true

async function loop() {
  await tick()
  while (running) {
    await new Promise(resolve => {
      timer = setTimeout(resolve, msUntilNextHour())
    })
    if (running) await tick()
  }
}

process.on('SIGINT', () => {
  running = false
  if (timer) clearTimeout(timer)
  console.log('\nflow-hourly stopped')
  process.exit(0)
})

loop().catch(err => {
  console.error(err)
  process.exit(1)
})
