// MemoryTool 单元测试 — 使用内存 SQLite + 真实 MemoryRepo
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { MemoryRepo } from '../../../src/db/repositories/memory-repo.js'
import { MemoryTool } from '../../../src/tools/memory.js'
import type { ToolContext } from '../../../src/tools/base.js'

/** 建表 SQL */
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
  CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
`

/** 构造 mock context */
function makeContext(userId = 'user1'): ToolContext {
  return {
    sessionId: 'test-session',
    chatId: 'test-chat',
    userId,
    responder: { reply: async () => {}, replyCard: async () => {} } as never,
  }
}

describe('MemoryTool', () => {
  let db: Database.Database
  let repo: MemoryRepo
  let tool: MemoryTool

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(CREATE_TABLE)
    repo = new MemoryRepo(db)
    tool = new MemoryTool(repo)
  })

  // --- save ---

  it('save preference — 返回内容包含"偏好"', async () => {
    const result = await tool.execute(
      { action: 'save', content: '喜欢暗色主题', type: 'preference' },
      makeContext(),
    )
    expect(result.content).toContain('偏好')
    expect(result.content).toContain('喜欢暗色主题')
  })

  it('save fact（默认 type）— 返回内容包含"事实"', async () => {
    const result = await tool.execute(
      { action: 'save', content: '用户是前端工程师' },
      makeContext(),
    )
    expect(result.content).toContain('事实')
    expect(result.content).toContain('用户是前端工程师')
  })

  it('save 缺少 content — 报错提示', async () => {
    const result = await tool.execute({ action: 'save' }, makeContext())
    expect(result.content).toContain('content')
  })

  // --- recall ---

  it('recall 有关键词 — 搜索并返回结果列表', async () => {
    repo.save({ userId: 'user1', chatId: null, type: 'fact', content: '喜欢 TypeScript' })
    repo.save({ userId: 'user1', chatId: null, type: 'fact', content: '使用 Python 做数据分析' })

    const result = await tool.execute(
      { action: 'recall', content: 'TypeScript' },
      makeContext(),
    )
    expect(result.content).toContain('1 条记忆')
    expect(result.content).toContain('TypeScript')
  })

  it('recall 无关键词 — 返回所有记忆', async () => {
    repo.save({ userId: 'user1', chatId: null, type: 'fact', content: '事实 A' })
    repo.save({ userId: 'user1', chatId: null, type: 'preference', content: '偏好 B' })

    const result = await tool.execute({ action: 'recall' }, makeContext())
    expect(result.content).toContain('2 条记忆')
    expect(result.content).toContain('事实 A')
    expect(result.content).toContain('偏好 B')
  })

  it('recall 无结果 — 返回"没有找到"', async () => {
    const result = await tool.execute(
      { action: 'recall', content: '不存在的关键词' },
      makeContext(),
    )
    expect(result.content).toContain('没有找到')
  })

  // --- delete ---

  it('delete 成功 — 返回"已删除"', async () => {
    const memory = repo.save({ userId: 'user1', chatId: null, type: 'fact', content: '待删除' })

    const result = await tool.execute(
      { action: 'delete', content: memory.id },
      makeContext(),
    )
    expect(result.content).toContain('已删除')
    // 确认数据库中已无此记录
    expect(repo.countByUser('user1')).toBe(0)
  })

  it('delete 不存在的 ID — 返回"未找到"', async () => {
    const result = await tool.execute(
      { action: 'delete', content: 'nonexistent-id' },
      makeContext(),
    )
    expect(result.content).toContain('未找到')
  })

  // --- 隔离性 ---

  it('不同 userId 隔离 — user1 保存的记忆 user2 搜索不到', async () => {
    await tool.execute(
      { action: 'save', content: 'user1 的秘密' },
      makeContext('user1'),
    )

    const result = await tool.execute(
      { action: 'recall', content: '秘密' },
      makeContext('user2'),
    )
    expect(result.content).toContain('没有找到')
  })

  // --- 异常 action ---

  it('不支持的 action — 返回"不支持"', async () => {
    const result = await tool.execute({ action: 'update' }, makeContext())
    expect(result.content).toContain('不支持')
  })
})
