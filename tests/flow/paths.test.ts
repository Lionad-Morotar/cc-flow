import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getFlowRegistryDir,
  getFlowRegistryPath,
  getProjectRoot,
} from '../../src/flow/paths.js'

describe('flow paths', () => {
  const originalRegistryDir = process.env.CC_FLOW_REGISTRY_DIR
  const originalProjectRoot = process.env.CC_FLOW_PROJECT_ROOT

  beforeEach(() => {
    delete process.env.CC_FLOW_REGISTRY_DIR
    delete process.env.CC_FLOW_PROJECT_ROOT
  })

  afterEach(() => {
    if (originalRegistryDir === undefined) delete process.env.CC_FLOW_REGISTRY_DIR
    else process.env.CC_FLOW_REGISTRY_DIR = originalRegistryDir
    if (originalProjectRoot === undefined) delete process.env.CC_FLOW_PROJECT_ROOT
    else process.env.CC_FLOW_PROJECT_ROOT = originalProjectRoot
  })

  it('defaults registry dir to ~/.claude/cc-flow, independent of cwd and project root', () => {
    // Even when a project root is set, the registry must NOT live under it —
    // otherwise a stray file at <project-root>/.tmp breaks bootstrap.
    process.env.CC_FLOW_PROJECT_ROOT = '/nonexistent/project-root'
    expect(getFlowRegistryDir()).toBe(join(homedir(), '.claude', 'cc-flow'))
  })

  it('honors CC_FLOW_REGISTRY_DIR override', () => {
    process.env.CC_FLOW_REGISTRY_DIR = '/tmp/custom-registry'
    expect(getFlowRegistryDir()).toBe('/tmp/custom-registry')
  })

  it('derives a registry file path from the registry dir', () => {
    process.env.CC_FLOW_REGISTRY_DIR = '/tmp/custom-registry'
    expect(getFlowRegistryPath('abcd1234')).toBe('/tmp/custom-registry/abcd1234.json')
  })

  it('keeps getProjectRoot as an explicit opt-in, never the registry location', () => {
    process.env.CC_FLOW_PROJECT_ROOT = '/explicit/root'
    expect(getProjectRoot()).toBe('/explicit/root')
    // No env → process.cwd(), but registry dir must still be ~/.claude/cc-flow.
    delete process.env.CC_FLOW_PROJECT_ROOT
    expect(getProjectRoot()).toBe(process.cwd())
    expect(getFlowRegistryDir()).toBe(join(homedir(), '.claude', 'cc-flow'))
  })
})
