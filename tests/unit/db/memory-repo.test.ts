// MemoryRepo 单元测试 — 长期记忆 CRUD
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { MemoryRepo } from '../../../src/db/repositories/memory-repo.js'
import type { MemoryType } from '../../../src/db/repositories/memory-repo.js'

let db: Database.Database
let repo: MemoryRepo

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
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
  `)
  repo = new MemoryRepo(db)
})

describe('MemoryRepo', () => {
  it('save + 查询验证', () => {
    const mem = repo.save({
      userId: 'u1',
      chatId: 'c1',
      type: 'preference',
      content: '偏好深色主题',
    })

    expect(mem.id).toBeTruthy()
    expect(mem.userId).toBe('u1')
    expect(mem.chatId).toBe('c1')
    expect(mem.type).toBe('preference')
    expect(mem.content).toBe('偏好深色主题')
    expect(mem.createdAt).toBeTruthy()
    expect(mem.updatedAt).toBeTruthy()

    const list = repo.getUserMemories('u1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(mem.id)
  })

  it('按 type 过滤（preference/fact）', () => {
    repo.save({ userId: 'u1', chatId: null, type: 'preference', content: '喜欢简洁' })
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '住在北京' })
    repo.save({ userId: 'u1', chatId: null, type: 'summary', content: '聊了天气' })

    const prefs = repo.getUserMemories('u1', ['preference'])
    expect(prefs).toHaveLength(1)
    expect(prefs[0].type).toBe('preference')

    const facts = repo.getUserMemories('u1', ['fact'])
    expect(facts).toHaveLength(1)
    expect(facts[0].type).toBe('fact')

    const both = repo.getUserMemories('u1', ['preference', 'fact'])
    expect(both).toHaveLength(2)
  })

  it('getUserMemories 无 types 参数默认返回 preference + fact', () => {
    repo.save({ userId: 'u1', chatId: null, type: 'preference', content: '偏好A' })
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '事实B' })
    repo.save({ userId: 'u1', chatId: null, type: 'summary', content: '摘要C' })

    const list = repo.getUserMemories('u1')
    expect(list).toHaveLength(2)
    const types = list.map(m => m.type)
    expect(types).toContain('preference')
    expect(types).toContain('fact')
    expect(types).not.toContain('summary')
  })

  it('关键词搜索匹配', () => {
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '用户喜欢吃火锅' })
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '用户养了一只猫' })
    repo.save({ userId: 'u1', chatId: null, type: 'preference', content: '偏好火锅底料麻辣' })

    const results = repo.search('u1', '火锅')
    expect(results).toHaveLength(2)
    expect(results.every(m => m.content.includes('火锅'))).toBe(true)
  })

  it('关键词搜索无结果', () => {
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '用户住在上海' })

    const results = repo.search('u1', '不存在的关键词')
    expect(results).toHaveLength(0)
  })

  it('最近摘要（顺序 + limit）', () => {
    // 按时间间隔插入，确保顺序
    for (let i = 1; i <= 8; i++) {
      const mem = repo.save({ userId: 'u1', chatId: null, type: 'summary', content: `摘要${i}` })
      // 手动更新 created_at 以确保顺序
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?')
        .run(`2026-01-0${i}T00:00:00.000Z`, mem.id)
    }

    const recent = repo.getRecentSummaries('u1', 3)
    expect(recent).toHaveLength(3)
    // DESC 排序，最新在前
    expect(recent[0].content).toBe('摘要8')
    expect(recent[1].content).toBe('摘要7')
    expect(recent[2].content).toBe('摘要6')

    // 默认 limit = 5
    const defaultLimit = repo.getRecentSummaries('u1')
    expect(defaultLimit).toHaveLength(5)
  })

  it('删除成功', () => {
    const mem = repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '待删除' })
    expect(repo.countByUser('u1')).toBe(1)

    const deleted = repo.delete(mem.id)
    expect(deleted).toBe(true)
    expect(repo.countByUser('u1')).toBe(0)
  })

  it('删除不存在的 ID 返回 false', () => {
    const deleted = repo.delete('non-existent-id')
    expect(deleted).toBe(false)
  })

  it('多用户隔离', () => {
    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '用户1的事实' })
    repo.save({ userId: 'u2', chatId: null, type: 'fact', content: '用户2的事实' })
    repo.save({ userId: 'u1', chatId: null, type: 'preference', content: '用户1的偏好' })

    const u1 = repo.getUserMemories('u1')
    const u2 = repo.getUserMemories('u2')
    expect(u1).toHaveLength(2)
    expect(u2).toHaveLength(1)

    // 搜索也隔离
    const u1Search = repo.search('u1', '用户')
    const u2Search = repo.search('u2', '用户')
    expect(u1Search).toHaveLength(2)
    expect(u2Search).toHaveLength(1)
  })

  it('countByUser 统计正确', () => {
    expect(repo.countByUser('u1')).toBe(0)

    repo.save({ userId: 'u1', chatId: null, type: 'fact', content: '事实1' })
    repo.save({ userId: 'u1', chatId: null, type: 'preference', content: '偏好1' })
    repo.save({ userId: 'u1', chatId: null, type: 'summary', content: '摘要1' })

    expect(repo.countByUser('u1')).toBe(3)
  })
})
