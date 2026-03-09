// 上下文管理器单元测试
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SessionRepo } from '../../../src/db/repositories/session-repo.js'
import { MemoryRepo } from '../../../src/db/repositories/memory-repo.js'
import { ContextManager } from '../../../src/agent/context-manager.js'
import type { SessionMessage } from '../../../src/db/repositories/session-repo.js'

/** 创建内存数据库并建表 */
function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      messages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT
    )
  `)
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_memories_user ON memories(user_id);
    CREATE INDEX idx_memories_user_type ON memories(user_id, type);
  `)
  return db
}

/** 生成指定数量的测试消息 */
function generateMessages(count: number, timestampOverride?: string): SessionMessage[] {
  const msgs: SessionMessage[] = []
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${i + 1}`,
      timestamp: timestampOverride ?? new Date().toISOString(),
    })
  }
  return msgs
}

/** mock 压缩函数 */
const mockCompressFn = vi.fn(
  async (msgs: SessionMessage[]) => `压缩摘要：${msgs.length}条消息`,
)

describe('ContextManager', () => {
  function setup(config?: { maxContextMessages?: number; compressThreshold?: number; sessionTimeoutMs?: number }) {
    const db = createTestDb()
    const sessionRepo = new SessionRepo(db)
    const memoryRepo = new MemoryRepo(db)
    mockCompressFn.mockClear()
    const cm = new ContextManager(sessionRepo, memoryRepo, mockCompressFn, config)
    return { db, sessionRepo, memoryRepo, cm }
  }

  it('消息数 < 阈值不触发压缩', async () => {
    const { sessionRepo, cm } = setup({ compressThreshold: 30 })
    const sid = 'sess-1'

    // 添加 10 条消息（远低于阈值 30）
    for (const msg of generateMessages(10)) {
      sessionRepo.addMessage(sid, msg)
    }

    await cm.compressIfNeeded(sid, 'user-1')

    // compressFn 不应被调用
    expect(mockCompressFn).not.toHaveBeenCalled()
    // 消息数量不变
    expect(sessionRepo.getHistory(sid)).toHaveLength(10)
  })

  it('消息数 > 阈值触发压缩，replaceMessages 格式正确', async () => {
    const { sessionRepo, cm } = setup({
      maxContextMessages: 20,
      compressThreshold: 15,
    })
    const sid = 'sess-2'

    // 添加 20 条消息（超过阈值 15）
    for (const msg of generateMessages(20)) {
      sessionRepo.addMessage(sid, msg)
    }

    await cm.compressIfNeeded(sid, 'user-1')

    // compressFn 应被调用
    expect(mockCompressFn).toHaveBeenCalledOnce()
    // 被压缩的是前 10 条（20 - keepCount(10)）
    expect(mockCompressFn.mock.calls[0][0]).toHaveLength(10)

    // 压缩后：1 条 system_summary + 10 条保留 = 11 条
    const history = sessionRepo.getHistory(sid)
    expect(history).toHaveLength(11)
    expect(history[0].role).toBe('system_summary')
    expect(history[0].content).toBe('压缩摘要：10条消息')
  })

  it('压缩后摘要写入 memories', async () => {
    const { sessionRepo, memoryRepo, cm } = setup({
      maxContextMessages: 20,
      compressThreshold: 15,
    })
    const sid = 'sess-3'
    const userId = 'user-mem'

    for (const msg of generateMessages(20)) {
      sessionRepo.addMessage(sid, msg)
    }

    await cm.compressIfNeeded(sid, userId)

    // 验证 memoryRepo 中存有 summary
    const summaries = memoryRepo.getRecentSummaries(userId)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].type).toBe('summary')
    expect(summaries[0].content).toBe('压缩摘要：10条消息')
  })

  it('超时切分：最后消息超过阈值时返回空', async () => {
    const { sessionRepo, cm } = setup({
      sessionTimeoutMs: 2 * 60 * 60 * 1000, // 2h
    })
    const sid = 'sess-timeout'
    const userId = 'user-timeout'

    // 添加 3 小时前的消息
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    for (const msg of generateMessages(5, threeHoursAgo)) {
      sessionRepo.addMessage(sid, { ...msg, timestamp: threeHoursAgo })
    }

    const result = await cm.getContextMessages(sid, userId)

    // 超时后返回空
    expect(result).toHaveLength(0)
  })

  it('超时后 session 被清空', async () => {
    const { sessionRepo, cm } = setup({
      sessionTimeoutMs: 2 * 60 * 60 * 1000,
    })
    const sid = 'sess-clear'
    const userId = 'user-clear'

    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    for (const msg of generateMessages(5, threeHoursAgo)) {
      sessionRepo.addMessage(sid, { ...msg, timestamp: threeHoursAgo })
    }

    await cm.getContextMessages(sid, userId)

    // session 应被清空
    expect(sessionRepo.getHistory(sid)).toHaveLength(0)
  })

  it('超时后摘要存入 memories', async () => {
    const { sessionRepo, memoryRepo, cm } = setup({
      sessionTimeoutMs: 2 * 60 * 60 * 1000,
    })
    const sid = 'sess-archive'
    const userId = 'user-archive'

    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    for (const msg of generateMessages(5, threeHoursAgo)) {
      sessionRepo.addMessage(sid, { ...msg, timestamp: threeHoursAgo })
    }

    await cm.getContextMessages(sid, userId)

    // compressFn 应被调用（5 条实际对话消息）
    expect(mockCompressFn).toHaveBeenCalledOnce()
    expect(mockCompressFn.mock.calls[0][0]).toHaveLength(5)

    // memory 中应有摘要
    const summaries = memoryRepo.getRecentSummaries(userId)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].content).toBe('压缩摘要：5条消息')
  })

  it('滑动窗口截取正确：30 条 → 返回最近 20 条', async () => {
    const { sessionRepo, cm } = setup({
      maxContextMessages: 20,
    })
    const sid = 'sess-window'

    for (const msg of generateMessages(30)) {
      sessionRepo.addMessage(sid, msg)
    }

    const result = await cm.getContextMessages(sid, 'user-w')

    expect(result).toHaveLength(20)
    // 应是最后 20 条（消息 11~30）
    expect(result[0].content).toBe('消息 11')
    expect(result[19].content).toBe('消息 30')
  })

  it('滑动窗口保留头部 system_summary：summary + 最近 19 条', async () => {
    const { sessionRepo, cm } = setup({
      maxContextMessages: 20,
    })
    const sid = 'sess-summary'

    // 先手动插入 system_summary + 29 条普通消息 = 30 条
    sessionRepo.getOrCreate(sid)
    const allMsgs: SessionMessage[] = [
      { role: 'system_summary', content: '之前的摘要', timestamp: new Date().toISOString() },
      ...generateMessages(29),
    ]
    sessionRepo.replaceMessages(sid, allMsgs)

    const result = await cm.getContextMessages(sid, 'user-s')

    // 应返回 20 条：1 条 summary + 最近 19 条
    expect(result).toHaveLength(20)
    expect(result[0].role).toBe('system_summary')
    expect(result[0].content).toBe('之前的摘要')
    // 最后 19 条是消息 11~29（0-indexed: allMsgs[11..29]）
    expect(result[1].content).toBe('消息 11')
    expect(result[19].content).toBe('消息 29')
  })
})
