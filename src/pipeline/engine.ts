// 管道引擎 — 调度 + 部分失败保存 + 阶段跳过
import { existsSync, unlinkSync } from 'node:fs'
import type {
  RawMessage,
  PipelineContext,
  ExtractedContent,
  ProcessedResult,
  WrittenNote,
  ParsedMessage,
  PipelineStage,
  CommandType,
} from '../types/index.js'
import { createContext } from './context.js'
import { parseMessage, extractUrls } from '../parser/message-parser.js'
import type { MessageRepo } from '../db/repositories/message-repo.js'
import type { JobRepo } from '../db/repositories/job-repo.js'
import type { Responder } from '../responder/base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('pipeline')

/** 二次处理选项 */
export interface ReprocessOptions {
  userInput?: string
  replaceOriginal?: boolean  // 默认 true（向后兼容）
}

/** 内容抓取接口 */
export interface Extractor {
  extract(parsed: ParsedMessage): Promise<ExtractedContent>
}

/** AI 处理接口 */
export interface Processor {
  process(parsed: ParsedMessage, extracted: ExtractedContent, onProgress?: (message: string) => void): Promise<ProcessedResult>
}

/** 笔记写入接口 */
export interface Writer {
  write(processed: ProcessedResult, context: PipelineContext): Promise<WrittenNote>
}

/**
 * 管道引擎 — 协调解析/去重/抓取/AI处理/写入/响应六阶段
 */
export class PipelineEngine {
  constructor(
    private messageRepo: MessageRepo,
    private jobRepo: JobRepo,
    private extractor: Extractor | null = null,
    private processor: Processor | null = null,
    private writer: Writer | null = null,
  ) {}

  /**
   * 执行完整管道
   */
  async execute(raw: RawMessage, responder: Responder): Promise<PipelineContext> {
    const ctx = createContext(raw)
    ctx.status = 'running'
    let jobId: string | null = null

    log.info({ id: ctx.id, eventId: raw.eventId, source: raw.source }, '管道开始')

    try {
      // 阶段 1: 去重检查
      ctx.stage = 'dedup'
      if (this.messageRepo.exists(raw.eventId)) {
        log.info({ eventId: raw.eventId }, '消息已处理，跳过')
        ctx.status = 'completed'
        ctx.completedAt = new Date()
        // U7: 去重后通知用户（非静默跳过）
        await responder.onProgress(ctx, '该消息已处理过，无需重复发送')
        return ctx
      }

      // 持久化消息
      const messageId = this.messageRepo.insert(raw)
      jobId = this.jobRepo.create(messageId)
      ctx.jobId = jobId

      // 阶段 2: 解析
      ctx.stage = 'parse'
      await responder.onProgress(ctx, '解析消息...')
      this.jobRepo.updateStatus(jobId, 'running', 'parse')
      ctx.parsed = parseMessage(raw)
      log.info({ command: ctx.parsed.command.type, contentType: ctx.parsed.content.type }, '消息解析完成')

      // U6: #help 指令 — 返回帮助文本，跳过后续管道
      if (ctx.parsed.command.type === 'help') {
        const unknown = ctx.parsed.command.args
          ? `未知指令 #${ctx.parsed.command.args}\n\n`
          : ''
        const helpText = `${unknown}可用指令：\n• #save — 保存并摘要\n• #discuss — 深度分析（Opus）\n• #quote — 提取金句\n• #help — 显示帮助\n• 直接发送 URL — 自动保存\n• 直接发送文本 — 生成笔记`
        await responder.onProgress(ctx, helpText)
        ctx.status = 'completed'
        ctx.completedAt = new Date()
        // 更新 job 状态（避免 pending 悬空）
        if (jobId) {
          this.jobRepo.updateStatus(jobId, 'completed', 'parse')
        }
        return ctx
      }

      // U10: 多 URL 提示（仅处理第一个）
      const urls = extractUrls(raw.rawText)
      if (urls.length > 1) {
        await responder.onProgress(ctx, `检测到 ${urls.length} 个链接，仅处理第一个`)
      }

      // 阶段 3: 抓取（无 URL 时跳过）
      ctx.stage = 'extract'
      if (ctx.parsed.content.type === 'url' || ctx.parsed.content.type === 'mixed') {
        const url = ctx.parsed.content.url
        if (this.extractor) {
          await responder.onProgress(ctx, `抓取内容: ${url}`)
          this.jobRepo.updateStatus(jobId, 'running', 'extract')
          ctx.extracted = await this.extractor.extract(ctx.parsed)
        } else {
          log.warn('Extractor 未配置，跳过抓取')
          ctx.extracted = {
            title: url,
            content: `来源: ${url}`,
            url,
            contentType: 'article',
          }
        }
      } else if (ctx.parsed.content.type === 'text') {
        // 纯文本直接构造 ExtractedContent
        ctx.extracted = {
          title: ctx.parsed.content.text.slice(0, 50),
          content: ctx.parsed.content.text,
          contentType: 'text',
        }
      } else if (ctx.parsed.content.type === 'image') {
        ctx.extracted = {
          title: ctx.parsed.content.text ?? '图片笔记',
          content: ctx.parsed.content.text ?? '',
          contentType: 'image',
        }
      }

      // 缓存抓取结果（供 reprocess 复用，避免重复抓取）
      if (ctx.extracted && jobId) {
        this.jobRepo.saveExtracted(jobId, JSON.stringify(ctx.extracted))
      }

      // 阶段 4: AI 处理（部分失败保存）
      ctx.stage = 'process'
      if (this.processor && ctx.extracted) {
        await responder.onProgress(ctx, 'AI 处理中...')
        this.jobRepo.updateStatus(jobId, 'running', 'process')

        // U1: 流式进度回调（3s 防抖，避免频繁更新飞书卡片）
        let lastProgressTime = 0
        const progressCallback = (msg: string) => {
          const now = Date.now()
          if (now - lastProgressTime < 1000) return
          lastProgressTime = now
          responder.onProgress(ctx, msg).catch(() => {})
        }

        try {
          ctx.processed = await this.processor.process(ctx.parsed, ctx.extracted, progressCallback)
        } catch (aiError) {
          // AI 处理失败 → 生成草稿继续写入
          log.warn({ error: String(aiError) }, 'AI 处理失败，生成草稿')
          ctx.processed = {
            title: ctx.extracted.title,
            summary: '',
            keyPoints: '',
            tags: ['draft'],
            content: ctx.extracted.content,
            model: 'none',
            isDraft: true,
          }
          ctx.status = 'draft'
          // 调度重试（草稿也需要自动重试）
          if (jobId) {
            this.jobRepo.scheduleRetry(jobId)
            log.info({ jobId }, '草稿已调度重试')
          }
        }
      } else if (ctx.extracted) {
        // 无 Processor，构造最小结果
        ctx.processed = {
          title: ctx.extracted.title,
          summary: '',
          keyPoints: '',
          tags: ['inbox'],
          content: ctx.extracted.content,
          model: 'none',
          isDraft: false,
        }
      }

      // 阶段 5: 写入
      ctx.stage = 'write'
      if (this.writer && ctx.processed) {
        await responder.onProgress(ctx, '写入 Obsidian...')
        this.jobRepo.updateStatus(jobId, 'running', 'write')
        ctx.written = await this.writer.write(ctx.processed, ctx)
      } else {
        log.info({ title: ctx.processed?.title }, 'Writer 未配置，跳过写入')
      }

      // 阶段 6: 响应
      ctx.stage = 'respond'
      if (ctx.status !== 'draft') {
        ctx.status = 'completed'
      }
      ctx.completedAt = new Date()

      // 更新数据库
      this.messageRepo.markProcessed(raw.eventId)
      this.jobRepo.updateStatus(jobId, ctx.status, 'respond')
      if (ctx.processed) {
        this.jobRepo.saveResult(jobId, JSON.stringify({
          title: ctx.processed.title,
          tags: ctx.processed.tags,
          filePath: ctx.written?.filePath,
        }))
      }

      await responder.onComplete(ctx)
      log.info({ id: ctx.id, status: ctx.status, duration: Date.now() - ctx.startedAt.getTime() }, '管道完成')

    } catch (error) {
      ctx.status = 'failed'
      ctx.error = String(error)
      ctx.completedAt = new Date()
      log.error({ id: ctx.id, error: ctx.error, stage: ctx.stage }, '管道失败')

      // 调度重试（最多 3 次）
      if (jobId) {
        this.jobRepo.scheduleRetry(jobId)
        log.info({ jobId }, '已调度重试')
      }

      // U3: 错误消息附带重试提示
      const retryHint = jobId ? '\n\n系统将自动重试，无需重复发送。' : ''
      const userError = new Error(String(error) + retryHint)
      await responder.onError(ctx, userError)
    }

    return ctx
  }

  /**
   * 扫描并执行可重试的失败任务（直接从缓存恢复，不创建新记录）
   */
  async retryFailed(): Promise<number> {
    const retryableJobs = this.jobRepo.getRetryable()
    if (retryableJobs.length === 0) return 0

    log.info({ count: retryableJobs.length }, '发现可重试任务')

    let retried = 0
    for (const job of retryableJobs) {
      try {
        log.info({ jobId: job.id, retryCount: job.retry_count }, '开始重试')
        this.jobRepo.updateStatus(job.id, 'running', (job.stage ?? 'process') as PipelineStage)

        // 从缓存恢复抓取内容（无缓存则永久放弃）
        const cachedExtracted = this.jobRepo.getExtracted(job.id)
        if (!cachedExtracted) {
          log.warn({ jobId: job.id }, '重试任务无缓存内容，永久放弃')
          this.jobRepo.updateStatus(job.id, 'failed', 'extract')
          continue
        }
        const extracted = JSON.parse(cachedExtracted) as ExtractedContent

        // 恢复原始消息以获取解析信息
        const msg = this.messageRepo.getById(job.message_id)
        if (!msg) {
          log.warn({ jobId: job.id, messageId: job.message_id }, '重试任务对应消息不存在，永久放弃')
          this.jobRepo.updateStatus(job.id, 'failed', 'parse')
          continue
        }

        const contentData = JSON.parse(msg.content_json) as { rawText: string }
        const raw: RawMessage = {
          eventId: msg.event_id,
          source: msg.source as RawMessage['source'],
          rawText: contentData.rawText,
          receivedAt: new Date(msg.received_at),
        }
        const parsed = parseMessage(raw)

        // 直接从 process 阶段继续（跳过 dedup/parse/extract）
        if (!this.processor) {
          log.warn({ jobId: job.id }, 'Processor 未配置，跳过重试')
          continue
        }

        const processed = await this.processor.process(parsed, extracted, () => {})

        // 构建上下文用于写入
        const ctx = createContext(raw)
        ctx.jobId = job.id
        ctx.parsed = parsed
        ctx.extracted = extracted
        ctx.processed = processed

        // 写入新笔记
        if (this.writer) {
          ctx.written = await this.writer.write(processed, ctx)
        }

        // 删除旧草稿文件
        if (job.result_json) {
          try {
            const oldResult = JSON.parse(job.result_json) as { filePath?: string }
            if (oldResult.filePath && existsSync(oldResult.filePath)) {
              unlinkSync(oldResult.filePath)
              log.info({ oldFile: oldResult.filePath }, '已删除旧草稿文件')
            }
          } catch (e) {
            log.warn({ error: String(e) }, '删除旧草稿文件失败（可忽略）')
          }
        }

        // 更新原 job 状态（不创建新记录，避免重试膨胀）
        this.jobRepo.updateStatus(job.id, 'completed', 'respond')
        this.jobRepo.saveResult(job.id, JSON.stringify({
          title: processed.title,
          tags: processed.tags,
          filePath: ctx.written?.filePath,
        }))

        log.info({ jobId: job.id }, '重试成功')
        retried++
      } catch (error) {
        log.warn({ jobId: job.id, error: String(error) }, '重试失败')
        // 调度下一次重试（retry_count+1，超过 3 次后不再重试）
        this.jobRepo.scheduleRetry(job.id)
      }
    }

    return retried
  }

  /**
   * 二次处理 — 用新指令重新处理已完成的任务
   */
  async reprocess(
    jobId: string,
    newCommand: CommandType | 'custom',
    responder: Responder,
    options?: ReprocessOptions,
  ): Promise<PipelineContext> {
    // 查找原始任务和消息
    const job = this.jobRepo.getById(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)

    const msg = this.messageRepo.getById(job.message_id)
    if (!msg) throw new Error(`Message for job ${jobId} not found`)

    // 重建 RawMessage（使用唯一 eventId 避免去重）
    const contentData = JSON.parse(msg.content_json) as { rawText: string }
    const raw: RawMessage = {
      eventId: `reprocess-${msg.event_id}-${Date.now()}`,
      source: msg.source as RawMessage['source'],
      rawText: contentData.rawText,
      receivedAt: new Date(msg.received_at),
    }

    const ctx = createContext(raw)
    ctx.status = 'running'
    ctx.jobId = jobId
    ctx.isReprocess = true

    const userInput = options?.userInput
    const replaceOriginal = options?.replaceOriginal ?? true  // 旧调用兼容默认替换

    log.info({ jobId, newCommand, userInput, replaceOriginal }, '二次处理开始')

    try {
      // 解析并覆盖指令
      ctx.stage = 'parse'
      await responder.onProgress(ctx, '解析消息...')
      ctx.parsed = parseMessage(raw)

      const commandType = (newCommand === 'custom' ? 'discuss' : newCommand) as CommandType
      ctx.parsed.command = { type: commandType, args: userInput }

      // 抓取内容（优先读缓存，避免重复抓取）
      ctx.stage = 'extract'
      const cachedExtracted = this.jobRepo.getExtracted(jobId)
      if (cachedExtracted) {
        ctx.extracted = JSON.parse(cachedExtracted) as ExtractedContent
        log.info({ jobId }, '使用缓存的抓取内容')
      } else if (ctx.parsed.content.type === 'url' || ctx.parsed.content.type === 'mixed') {
        const url = ctx.parsed.content.url
        if (this.extractor) {
          await responder.onProgress(ctx, `抓取内容: ${url}`)
          ctx.extracted = await this.extractor.extract(ctx.parsed)
        } else {
          ctx.extracted = {
            title: url,
            content: `来源: ${url}`,
            url,
            contentType: 'article',
          }
        }
      } else if (ctx.parsed.content.type === 'text') {
        ctx.extracted = {
          title: ctx.parsed.content.text.slice(0, 50),
          content: ctx.parsed.content.text,
          contentType: 'text',
        }
      }

      // AI 处理（使用新指令）
      ctx.stage = 'process'
      if (this.processor && ctx.extracted) {
        await responder.onProgress(ctx, 'AI 处理中...')

        // U1: 流式进度回调（3s 防抖）
        let lastProgressTime = 0
        const progressCallback = (msg: string) => {
          const now = Date.now()
          if (now - lastProgressTime < 1000) return
          lastProgressTime = now
          responder.onProgress(ctx, msg).catch(() => {})
        }

        ctx.processed = await this.processor.process(ctx.parsed, ctx.extracted, progressCallback)
      }

      // 写入新笔记
      ctx.stage = 'write'
      if (this.writer && ctx.processed) {
        await responder.onProgress(ctx, '写入 Obsidian...')
        ctx.written = await this.writer.write(ctx.processed, ctx)
      }

      // 替换模式：删除原笔记文件（新建模式跳过）
      let oldResultData: { filePath?: string; originalFilePath?: string } | undefined
      if (job.result_json) {
        try {
          oldResultData = JSON.parse(job.result_json) as { filePath?: string; originalFilePath?: string }
          if (replaceOriginal && oldResultData.filePath && ctx.written?.filePath !== oldResultData.filePath && existsSync(oldResultData.filePath)) {
            unlinkSync(oldResultData.filePath)
            log.info({ oldFile: oldResultData.filePath }, '已删除原笔记文件')
          }
        } catch (e) {
          log.warn({ error: String(e) }, '删除原笔记文件失败（可忽略）')
        }
      }

      // 更新任务状态
      ctx.stage = 'respond'
      ctx.status = 'completed'
      ctx.completedAt = new Date()

      this.jobRepo.updateStatus(jobId, 'completed', 'respond')
      if (ctx.processed) {
        this.jobRepo.saveResult(jobId, JSON.stringify({
          title: ctx.processed.title,
          tags: ctx.processed.tags,
          filePath: ctx.written?.filePath,
          // 新建模式下记录原文件路径（可追溯）
          originalFilePath: !replaceOriginal && oldResultData?.filePath
            ? (oldResultData.originalFilePath ?? oldResultData.filePath)
            : undefined,
        }))
      }

      await responder.onComplete(ctx)
      log.info({ jobId, newCommand, duration: Date.now() - ctx.startedAt.getTime() }, '二次处理完成')

    } catch (error) {
      ctx.status = 'failed'
      ctx.error = String(error)
      ctx.completedAt = new Date()
      log.error({ jobId, error: ctx.error }, '二次处理失败')

      await responder.onError(ctx, error instanceof Error ? error : new Error(String(error)))
    }

    return ctx
  }
}
