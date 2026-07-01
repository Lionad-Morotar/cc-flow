import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

// Flow 的 bundle 直接产出到 scripts/ 目录，让 Claude Code plugin 从
// GitHub 安装后无需构建步骤即可运行。
// splitting: false 保证每个 bundle 是自包含单文件，运行时与项目其余部分解耦。

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

const base = {
  format: ['cjs'] as ['cjs'],
  dts: false,
  splitting: false,
  sourcemap: true,
  outDir: 'scripts',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __CC_FLOW_VERSION__: JSON.stringify(pkg.version ?? '0.2.0'),
  },
}

export default defineConfig([
  {
    ...base,
    entry: { 'flow-bridge': 'src/flow/bridge.ts' },
    clean: true,
  },
  {
    ...base,
    entry: { 'flow-bootstrap': 'src/flow/bootstrap.ts' },
    clean: false,
  },
  {
    ...base,
    entry: { 'flow-cleanup': 'src/flow/cleanup.ts' },
    clean: false,
  },
  {
    ...base,
    entry: { 'cc-flow-mcp': 'src/mcp/server.ts' },
    clean: false,
  },
])
