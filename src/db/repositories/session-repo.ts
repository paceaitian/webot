// Agent 会话持久化
import type Database from 'better-sqlite3'

/** 会话消息 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool_result' | 'system_summary'
  content: string
  toolUseId?: string
  timestamp?: string
}

/** 会话数据 */
export interface Session {
  id: string
  messages: SessionMessage[]
  createdAt: string
  updatedAt: string
}

/**
 * 会话 Repository — SQLite CRUD
 */
export class SessionRepo {
  constructor(private db: Database.Database) {}

  /** 获取或创建会话 */
  getOrCreate(chatId: string): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(chatId) as
      | { id: string; messages: string; created_at: string; updated_at: string }
      | undefined

    if (row) {
      return {
        id: row.id,
        messages: JSON.parse(row.messages),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }

    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO sessions (id, messages, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(chatId, '[]', now, now)

    return { id: chatId, messages: [], createdAt: now, updatedAt: now }
  }

  /** 追加消息 */
  addMessage(chatId: string, message: SessionMessage): void {
    message.timestamp = message.timestamp ?? new Date().toISOString()
    const session = this.getOrCreate(chatId)
    session.messages.push(message)
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(session.messages), new Date().toISOString(), chatId)
  }

  /** 获取消息历史 */
  getHistory(chatId: string): SessionMessage[] {
    const session = this.getOrCreate(chatId)
    return session.messages
  }

  /** 清空会话消息 */
  clear(chatId: string): void {
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run('[]', new Date().toISOString(), chatId)
  }

  /** 替换全部消息（用于压缩） */
  replaceMessages(chatId: string, messages: SessionMessage[]): void {
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(messages), new Date().toISOString(), chatId)
  }
}
