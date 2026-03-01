// 管道引擎集成测试 — mock AI + mock 抓取，验证完整流程
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '../../src/db/database.js'
import { MessageRepo } from '../../src/db/repositories/message-repo.js'
import { JobRepo } from '../../src/db/repositories/job-repo.js'
import { PipelineEngine } from '../../src/pipeline/engine.js'
import type { Extractor, Processor, Writer } from '../../src/pipeline/engine.js'
import type { Responder } from '../../src/responder/base.js'
import type { RawMessage, ExtractedContent, ProcessedResult, PipelineContext, WrittenNote, ParsedMessage } from '../../src/types/index.js'
import { ObsidianWriter } from '../../src/writer/obsidian-writer.js'

/** 静默响应器 */
const silentResponder: Responder = {
  onProgress: async () => {},
  onComplete: async () => {},
  onError: async () => {},
}

/** Mock Extractor */
function createMockExtractor(result?: Partial<ExtractedContent>): Extractor {
  return {
    async extract(_parsed: ParsedMessage): Promise<ExtractedContent> {
      return {
        title: result?.title ?? '测试文章标题',
        content: result?.content ?? '这是测试文章的正文内容，包含一些有用的信息。',
        url: result?.url ?? 'https://example.com/test',
        contentType: result?.contentType ?? 'article',
        author: result?.author,
        siteName: result?.siteName,
      }
    },
  }
}

/** Mock Processor */
function createMockProcessor(result?: Partial<ProcessedResult>): Processor {
  return {
    async process(_parsed: ParsedMessage, _extracted: ExtractedContent): Promise<ProcessedResult> {
      return {
        title: result?.title ?? '测试文章标题',
        summary: result?.summary ?? '这是一篇关于测试的文章摘要',
        tags: result?.tags ?? ['测试', '技术'],
        content: result?.content ?? '处理后的正文内容',
        model: result?.model ?? 'mock-model',
        isDraft: result?.isDraft ?? false,
      }
    },
  }
}

/** 创建失败的 Mock Processor */
function createFailingProcessor(): Processor {
  return {
    async process(): Promise<ProcessedResult> {
      throw new Error('AI 处理模拟失败')
    },
  }
}

describe('管道引擎集成测试', () => {
  let tmpDir: string
  let db: AppDatabase
  let messageRepo: MessageRepo
  let jobRepo: JobRepo

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'webot-test-'))
    db = new AppDatabase(join(tmpDir, 'test.db'))
    messageRepo = new MessageRepo(db.db)
    jobRepo = new JobRepo(db.db)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeRaw(text: string, eventId?: string): RawMessage {
    return {
      eventId: eventId ?? `test-${Date.now()}`,
      source: 'cli',
      rawText: text,
      receivedAt: new Date(),
    }
  }

  it('完整管道：URL 消息 → 抓取 → AI 处理 → 写入', async () => {
    const vaultPath = join(tmpDir, 'vault')
    const writer = new ObsidianWriter(vaultPath)
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      createMockExtractor(), createMockProcessor(), writer,
    )

    const raw = makeRaw('#save https://example.com/article')
    const ctx = await pipeline.execute(raw, silentResponder)

    expect(ctx.status).toBe('completed')
    expect(ctx.parsed).toBeDefined()
    expect(ctx.parsed!.command.type).toBe('save')
    expect(ctx.extracted).toBeDefined()
    expect(ctx.processed).toBeDefined()
    expect(ctx.written).toBeDefined()

    // 验证文件已写入
    expect(existsSync(ctx.written!.filePath)).toBe(true)
    const content = readFileSync(ctx.written!.filePath, 'utf-8')
    expect(content).toContain('status: inbox')
    expect(content).toContain('处理后的正文内容')
  })

  it('纯文本消息跳过抓取阶段', async () => {
    const vaultPath = join(tmpDir, 'vault')
    const writer = new ObsidianWriter(vaultPath)
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      createMockExtractor(), createMockProcessor(), writer,
    )

    const raw = makeRaw('这是一段纯文本笔记')
    const ctx = await pipeline.execute(raw, silentResponder)

    expect(ctx.status).toBe('completed')
    expect(ctx.parsed!.content.type).toBe('text')
    expect(ctx.written).toBeDefined()
  })

  it('消息去重：相同 eventId 跳过', async () => {
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      createMockExtractor(), createMockProcessor(), null,
    )

    const eventId = 'dup-test-001'
    const raw1 = makeRaw('#save https://example.com', eventId)
    const raw2 = makeRaw('#save https://example.com', eventId)

    const ctx1 = await pipeline.execute(raw1, silentResponder)
    expect(ctx1.status).toBe('completed')

    const ctx2 = await pipeline.execute(raw2, silentResponder)
    expect(ctx2.status).toBe('completed')
    // 第二次应该在去重阶段就返回，不会有 parsed
    expect(ctx2.parsed).toBeUndefined()
  })

  it('AI 失败 → 草稿保存', async () => {
    const vaultPath = join(tmpDir, 'vault')
    const writer = new ObsidianWriter(vaultPath)
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      createMockExtractor(), createFailingProcessor(), writer,
    )

    const raw = makeRaw('#save https://example.com/fail')
    const ctx = await pipeline.execute(raw, silentResponder)

    expect(ctx.status).toBe('draft')
    expect(ctx.processed).toBeDefined()
    expect(ctx.processed!.isDraft).toBe(true)
    expect(ctx.processed!.tags).toContain('draft')
    // 草稿仍应写入文件
    expect(ctx.written).toBeDefined()
    expect(existsSync(ctx.written!.filePath)).toBe(true)
  })

  it('响应器收到正确的进度回调', async () => {
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      createMockExtractor(), createMockProcessor(), null,
    )

    const progressMessages: string[] = []
    let completeCalled = false
    const trackingResponder: Responder = {
      onProgress: async (_ctx: PipelineContext, message: string) => {
        progressMessages.push(message)
      },
      onComplete: async () => {
        completeCalled = true
      },
      onError: async () => {},
    }

    const raw = makeRaw('#save https://example.com/track')
    await pipeline.execute(raw, trackingResponder)

    expect(progressMessages.length).toBeGreaterThanOrEqual(2)
    expect(progressMessages[0]).toContain('解析')
    expect(completeCalled).toBe(true)
  })

  it('重试队列：失败任务被标记为可重试', async () => {
    // 构造一个在抓取阶段崩溃的 extractor
    const failExtractor: Extractor = {
      async extract(): Promise<ExtractedContent> {
        throw new Error('网络超时')
      },
    }
    const pipeline = new PipelineEngine(
      messageRepo, jobRepo,
      failExtractor, createMockProcessor(), null,
    )

    const raw = makeRaw('#save https://example.com/timeout')
    const ctx = await pipeline.execute(raw, silentResponder)

    expect(ctx.status).toBe('failed')

    // 检查 job 已调度重试
    const retryable = jobRepo.getRetryable()
    // next_retry_at 在未来，所以 getRetryable 可能不会返回
    // 但 job 状态应该是 failed 且 retry_count > 0
    const jobs = db.db.prepare('SELECT * FROM jobs WHERE status = ?').all('failed') as Array<{ retry_count: number }>
    expect(jobs.length).toBe(1)
    expect(jobs[0].retry_count).toBe(1)
  })
})
