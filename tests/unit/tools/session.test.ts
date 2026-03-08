import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../../src/db/migrations.js'
import { SessionRepo } from '../../../src/db/repositories/session-repo.js'

describe('SessionRepo', () => {
  let db: Database.Database
  let repo: SessionRepo

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new SessionRepo(db)
  })

  afterEach(() => {
    db.close()
  })

  it('getOrCreate 首次创建新 session', () => {
    const session = repo.getOrCreate('chat_123')
    expect(session.id).toBe('chat_123')
    expect(session.messages).toEqual([])
  })

  it('getOrCreate 再次获取返回已有 session', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hello' })
    const s2 = repo.getOrCreate('chat_123')
    expect(s2.messages).toHaveLength(1)
  })

  it('addMessage 追加消息', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    repo.addMessage('chat_123', { role: 'assistant', content: 'hello' })
    const session = repo.getOrCreate('chat_123')
    expect(session.messages).toHaveLength(2)
    expect(session.messages[0].content).toBe('hi')
  })

  it('clear 清空消息', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    repo.clear('chat_123')
    const session = repo.getOrCreate('chat_123')
    expect(session.messages).toEqual([])
  })

  it('getHistory 返回消息数组', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    const history = repo.getHistory('chat_123')
    expect(history).toHaveLength(1)
  })

  it('replaceMessages 替换全部消息', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'old' })
    repo.replaceMessages('chat_123', [{ role: 'assistant', content: 'compressed' }])
    const session = repo.getOrCreate('chat_123')
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].content).toBe('compressed')
  })
})
