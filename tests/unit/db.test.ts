// SQLite 数据层单元测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AppDatabase } from '../../src/db/database.js'
import { MessageRepo } from '../../src/db/repositories/message-repo.js'
import { JobRepo } from '../../src/db/repositories/job-repo.js'
import type { RawMessage } from '../../src/types/index.js'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'

const TEST_DB_DIR = join(process.cwd(), 'data', 'test')
let dbPath: string
let appDb: AppDatabase
let messageRepo: MessageRepo
let jobRepo: JobRepo

beforeEach(() => {
  mkdirSync(TEST_DB_DIR, { recursive: true })
  dbPath = join(TEST_DB_DIR, `test-${Date.now()}.db`)
  appDb = new AppDatabase(dbPath)
  messageRepo = new MessageRepo(appDb.db)
  jobRepo = new JobRepo(appDb.db)
})

afterEach(() => {
  appDb.close()
  // 清理测试数据库
  try { rmSync(dbPath) } catch { /* ignore */ }
  try { rmSync(dbPath + '-wal') } catch { /* ignore */ }
  try { rmSync(dbPath + '-shm') } catch { /* ignore */ }
})

function makeRaw(eventId: string): RawMessage {
  return {
    eventId,
    source: 'cli',
    rawText: '测试消息',
    receivedAt: new Date(),
  }
}

describe('AppDatabase', () => {
  it('初始化数据库并创建表', () => {
    const tables = appDb.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('messages')
    expect(names).toContain('jobs')
    expect(names).toContain('schema_version')
  })

  it('WAL 模式已启用', () => {
    const result = appDb.db.pragma('journal_mode') as { journal_mode: string }[]
    expect(result[0].journal_mode).toBe('wal')
  })
})

describe('MessageRepo', () => {
  it('插入并检查消息存在', () => {
    const raw = makeRaw('evt-001')
    expect(messageRepo.exists('evt-001')).toBe(false)
    messageRepo.insert(raw)
    expect(messageRepo.exists('evt-001')).toBe(true)
  })

  it('重复 event_id 插入抛出错误（去重）', () => {
    const raw = makeRaw('evt-dup')
    messageRepo.insert(raw)
    expect(() => messageRepo.insert(raw)).toThrow()
  })

  it('标记消息已处理', () => {
    const raw = makeRaw('evt-proc')
    messageRepo.insert(raw)
    messageRepo.markProcessed('evt-proc')
    const row = appDb.db.prepare('SELECT processed_at FROM messages WHERE event_id = ?').get('evt-proc') as { processed_at: string }
    expect(row.processed_at).toBeTruthy()
  })
})

describe('JobRepo', () => {
  it('创建任务并查询', () => {
    const msgId = messageRepo.insert(makeRaw('evt-job-1'))
    const jobId = jobRepo.create(msgId)
    const job = jobRepo.getById(jobId)
    expect(job).toBeDefined()
    expect(job!.status).toBe('pending')
    expect(job!.message_id).toBe(msgId)
  })

  it('更新任务状态', () => {
    const msgId = messageRepo.insert(makeRaw('evt-job-2'))
    const jobId = jobRepo.create(msgId)
    jobRepo.updateStatus(jobId, 'running', 'extract')
    const job = jobRepo.getById(jobId)
    expect(job!.status).toBe('running')
    expect(job!.stage).toBe('extract')
  })

  it('保存处理结果', () => {
    const msgId = messageRepo.insert(makeRaw('evt-job-3'))
    const jobId = jobRepo.create(msgId)
    jobRepo.saveResult(jobId, JSON.stringify({ title: '测试' }))
    const job = jobRepo.getById(jobId)
    expect(JSON.parse(job!.result_json!)).toEqual({ title: '测试' })
  })

  it('调度重试 + 获取可重试任务', () => {
    const msgId = messageRepo.insert(makeRaw('evt-retry'))
    const jobId = jobRepo.create(msgId)
    jobRepo.updateStatus(jobId, 'failed', 'process', '模拟错误')

    // 设置 next_retry_at 为过去时间（立即可重试）
    appDb.db.prepare(
      'UPDATE jobs SET next_retry_at = ?, retry_count = 1 WHERE id = ?'
    ).run(new Date(Date.now() - 1000).toISOString(), jobId)

    const retryable = jobRepo.getRetryable()
    expect(retryable.length).toBe(1)
    expect(retryable[0].id).toBe(jobId)
  })

  it('超过 3 次重试不再返回', () => {
    const msgId = messageRepo.insert(makeRaw('evt-max-retry'))
    const jobId = jobRepo.create(msgId)
    appDb.db.prepare(
      'UPDATE jobs SET status = ?, retry_count = 3, next_retry_at = ? WHERE id = ?'
    ).run('failed', new Date(Date.now() - 1000).toISOString(), jobId)

    const retryable = jobRepo.getRetryable()
    expect(retryable.length).toBe(0)
  })
})
