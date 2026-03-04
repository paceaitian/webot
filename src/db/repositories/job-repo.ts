// 处理任务仓储 — 任务记录 + 重试队列
import type Database from 'better-sqlite3'
import { generateId } from '../../utils/id.js'
import type { PipelineStatus, PipelineStage } from '../../types/index.js'

/** 任务记录行 */
export interface JobRow {
  id: string
  message_id: string
  status: string
  stage: string | null
  result_json: string | null
  extracted_json: string | null
  error_text: string | null
  retry_count: number
  next_retry_at: string | null
  created_at: string
  updated_at: string
}

/** 任务仓储 */
export class JobRepo {
  constructor(private db: Database.Database) {}

  /** 创建新任务 */
  create(messageId: string): string {
    const id = generateId()
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO jobs (id, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, messageId, 'pending', now, now)
    return id
  }

  /** 更新任务状态 */
  updateStatus(jobId: string, status: PipelineStatus, stage?: PipelineStage, errorText?: string): void {
    this.db.prepare(
      'UPDATE jobs SET status = ?, stage = ?, error_text = ?, updated_at = ? WHERE id = ?'
    ).run(status, stage ?? null, errorText ?? null, new Date().toISOString(), jobId)
  }

  /** 保存处理结果 */
  saveResult(jobId: string, resultJson: string): void {
    this.db.prepare(
      'UPDATE jobs SET result_json = ?, updated_at = ? WHERE id = ?'
    ).run(resultJson, new Date().toISOString(), jobId)
  }

  /** 获取可重试的任务（包含 failed 和 draft 状态） */
  getRetryable(): JobRow[] {
    const now = new Date().toISOString()
    return this.db.prepare(
      'SELECT * FROM jobs WHERE status IN (?, ?) AND next_retry_at <= ? AND retry_count < 3'
    ).all('failed', 'draft', now) as JobRow[]
  }

  /** 调度重试（指数退避：1min/2min/4min） */
  scheduleRetry(jobId: string): void {
    const job = this.db.prepare('SELECT retry_count FROM jobs WHERE id = ?').get(jobId) as { retry_count: number } | undefined
    if (!job) return

    const delayMs = 60_000 * Math.pow(2, job.retry_count)
    const nextRetry = new Date(Date.now() + delayMs).toISOString()

    this.db.prepare(
      'UPDATE jobs SET status = ?, retry_count = retry_count + 1, next_retry_at = ?, updated_at = ? WHERE id = ?'
    ).run('failed', nextRetry, new Date().toISOString(), jobId)
  }

  /** 保存抓取内容缓存 */
  saveExtracted(jobId: string, json: string): void {
    this.db.prepare(
      'UPDATE jobs SET extracted_json = ?, updated_at = ? WHERE id = ?'
    ).run(json, new Date().toISOString(), jobId)
  }

  /** 获取抓取内容缓存 */
  getExtracted(jobId: string): string | null {
    const row = this.db.prepare('SELECT extracted_json FROM jobs WHERE id = ?').get(jobId) as { extracted_json: string | null } | undefined
    return row?.extracted_json ?? null
  }

  /** 崩溃恢复：将所有 running 状态的任务重置为 failed */
  resetRunning(): number {
    const result = this.db.prepare(
      "UPDATE jobs SET status = 'failed', updated_at = ? WHERE status = 'running'"
    ).run(new Date().toISOString())
    return result.changes
  }

  /** 根据 ID 获取任务 */
  getById(jobId: string): JobRow | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
  }
}
