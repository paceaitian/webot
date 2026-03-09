// 长期记忆 CRUD — 存储用户偏好、事实、对话摘要
import type Database from 'better-sqlite3'
import { generateId } from '../../utils/id.js'

/** 记忆类型 */
export type MemoryType = 'preference' | 'fact' | 'summary'

/** 记忆条目 */
export interface Memory {
  id: string
  userId: string
  chatId: string | null
  type: MemoryType
  content: string
  createdAt: string
  updatedAt: string
}

/** 数据库行映射 */
interface MemoryRow {
  id: string
  user_id: string
  chat_id: string | null
  type: string
  content: string
  created_at: string
  updated_at: string
}

/**
 * 记忆 Repository — 长期记忆的 SQLite CRUD
 */
export class MemoryRepo {
  constructor(private db: Database.Database) {}

  /** 存储记忆（INSERT OR REPLACE） */
  save(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Memory {
    const id = generateId()
    const now = new Date().toISOString()

    this.db.prepare(
      `INSERT OR REPLACE INTO memories (id, user_id, chat_id, type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, memory.userId, memory.chatId ?? null, memory.type, memory.content, now, now)

    return {
      id,
      userId: memory.userId,
      chatId: memory.chatId,
      type: memory.type as MemoryType,
      content: memory.content,
      createdAt: now,
      updatedAt: now,
    }
  }

  /** 按用户查询记忆，默认返回 preference + fact */
  getUserMemories(userId: string, types?: string[]): Memory[] {
    const filterTypes = types ?? ['preference', 'fact']
    const placeholders = filterTypes.map(() => '?').join(', ')
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC`,
    ).all(userId, ...filterTypes) as MemoryRow[]

    return rows.map(toMemory)
  }

  /** 按关键词搜索记忆（LIKE 模糊匹配） */
  search(userId: string, query: string, limit = 20): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY updated_at DESC LIMIT ?`,
    ).all(userId, `%${query}%`, limit) as MemoryRow[]

    return rows.map(toMemory)
  }

  /** 获取最近 N 条摘要，按 created_at DESC */
  getRecentSummaries(userId: string, limit = 5): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND type = 'summary' ORDER BY created_at DESC LIMIT ?`,
    ).all(userId, limit) as MemoryRow[]

    return rows.map(toMemory)
  }

  /** 删除记忆，返回是否删除成功 */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** 按用户统计记忆数量 */
  countByUser(userId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM memories WHERE user_id = ?',
    ).get(userId) as { count: number }
    return row.count
  }
}

/** 数据库行 → Memory 对象 */
function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    type: row.type as MemoryType,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
