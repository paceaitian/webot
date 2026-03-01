// 消息去重仓储
import type Database from 'better-sqlite3'
import type { RawMessage } from '../../types/index.js'
import { generateId } from '../../utils/id.js'

/** 消息记录行 */
export interface MessageRow {
  id: string
  event_id: string
  source: string
  content_json: string
  received_at: string
  processed_at: string | null
}

/** 消息仓储 — 负责去重和消息持久化 */
export class MessageRepo {
  constructor(private db: Database.Database) {}

  /** 检查 eventId 是否已存在 */
  exists(eventId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM messages WHERE event_id = ?'
    ).get(eventId)
    return row !== undefined
  }

  /** 插入新消息，返回生成的 id */
  insert(raw: RawMessage): string {
    const id = generateId()
    this.db.prepare(
      'INSERT INTO messages (id, event_id, source, content_json, received_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      id,
      raw.eventId,
      raw.source,
      JSON.stringify({ rawText: raw.rawText }),
      raw.receivedAt.toISOString(),
    )
    return id
  }

  /** 标记消息已处理 */
  markProcessed(eventId: string): void {
    this.db.prepare(
      'UPDATE messages SET processed_at = ? WHERE event_id = ?'
    ).run(new Date().toISOString(), eventId)
  }

  /** 根据 ID 获取消息行 */
  getById(id: string): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  }

  /** 重置消息已处理状态（用于重试） */
  resetProcessed(eventId: string): void {
    this.db.prepare(
      'UPDATE messages SET processed_at = NULL WHERE event_id = ?'
    ).run(eventId)
  }
}
