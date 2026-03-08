import { describe, it, expect, vi } from 'vitest'
import { AgentLoop } from '../../../src/agent/loop.js'
import { ToolRegistry } from '../../../src/tools/registry.js'
import type { SessionRepo } from '../../../src/db/repositories/session-repo.js'

/** Mock SessionRepo */
function mockSessionRepo(): SessionRepo {
  const messages: Array<{ role: string; content: string }> = []
  return {
    getOrCreate: vi.fn().mockReturnValue({ id: 'test', messages, createdAt: '', updatedAt: '' }),
    addMessage: vi.fn((_, msg) => messages.push(msg)),
    getHistory: vi.fn(() => messages),
    clear: vi.fn(),
    replaceMessages: vi.fn(),
  } as unknown as SessionRepo
}

describe('AgentLoop', () => {
  it('应能创建实例', () => {
    const registry = new ToolRegistry()
    const sessionRepo = mockSessionRepo()
    const loop = new AgentLoop(registry, sessionRepo, { apiKey: 'test' })
    expect(loop).toBeDefined()
  })
})
