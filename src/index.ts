// Webot 主入口 — CLI / 飞书模式
import { loadConfig } from './config.js'
import { AppDatabase } from './db/database.js'
import { MessageRepo } from './db/repositories/message-repo.js'
import { JobRepo } from './db/repositories/job-repo.js'
import { SessionRepo } from './db/repositories/session-repo.js'
import { PipelineEngine } from './pipeline/engine.js'
import { ContentExtractor } from './extractor/index.js'
import { AIProcessor } from './processor/index.js'
import { ObsidianWriter } from './writer/obsidian-writer.js'
import { ToolRegistry } from './tools/registry.js'
import { SaveTool } from './tools/save.js'
import { DigestTool } from './tools/digest.js'
import { DiscussTool } from './tools/discuss.js'
import { WebFetchTool } from './tools/web-fetch.js'
import { SearchVaultTool } from './tools/search-vault.js'
import { ReadNoteTool } from './tools/read-note.js'
import { WebSearchTool } from './tools/web-search.js'
import { CreateNoteTool } from './tools/create-note.js'
import { MemoryTool } from './tools/memory.js'
import { AgentLoop } from './agent/loop.js'
import { ContextManager } from './agent/context-manager.js'
import { MemoryRepo } from './db/repositories/memory-repo.js'
import { CliAdapter } from './adapters/cli.js'
import { FeishuAdapter } from './adapters/feishu.js'
import { createLogger } from './utils/logger.js'
import cron from 'node-cron'
import { DigestEngine } from './digest/index.js'
import OpenAI from 'openai'

const log = createLogger('main')

async function main() {
  const config = loadConfig()

  log.info({ cliMode: config.cliMode }, 'Webot 启动中...')

  // 初始化数据库
  const db = new AppDatabase(config.dbPath)
  const messageRepo = new MessageRepo(db.db)
  const jobRepo = new JobRepo(db.db)

  // 崩溃恢复：将上次未完成的 running 任务重置为 failed
  const resetCount = jobRepo.resetRunning()
  if (resetCount > 0) {
    log.info({ count: resetCount }, '崩溃恢复：已重置 running 任务为 failed')
  }

  // 初始化 Writer（用于获取附件目录）
  const writer = new ObsidianWriter(config.obsidianVaultPath)

  // 初始化 Extractor（共享 BrowserPool）
  const extractor = new ContentExtractor()

  // 初始化 AI Processor
  const processor = new AIProcessor(config.anthropicApiKey, config.anthropicBaseUrl || undefined, config.aiModel)

  // 构建管道引擎
  const pipeline = new PipelineEngine(messageRepo, jobRepo, extractor, processor, writer)

  // 初始化 Agent 组件
  const sessionRepo = new SessionRepo(db.db)
  const memoryRepo = new MemoryRepo(db.db)
  const digestEngine = new DigestEngine(processor.getClaudeClient())
  const toolRegistry = new ToolRegistry()
  toolRegistry.register(new SaveTool(pipeline))
  toolRegistry.register(new DiscussTool(pipeline))
  toolRegistry.register(new WebFetchTool(extractor))
  toolRegistry.register(new SearchVaultTool(config.obsidianVaultPath))
  toolRegistry.register(new ReadNoteTool(config.obsidianVaultPath))
  toolRegistry.register(new WebSearchTool(config.serperApiKey))
  toolRegistry.register(new CreateNoteTool(config.obsidianVaultPath))
  toolRegistry.register(new MemoryTool(memoryRepo))
  const digestTool = new DigestTool(digestEngine, config.obsidianVaultPath)
  toolRegistry.register(digestTool)

  // 创建 ContextManager（GLM-4.7 压缩函数）
  const openaiClient = new OpenAI({
    apiKey: config.anthropicApiKey,
    baseURL: config.anthropicBaseUrl || undefined,
  })
  const compressFn = async (messages: import('./db/repositories/session-repo.js').SessionMessage[]) => {
    const text = messages.map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 8000)
    try {
      const resp = await openaiClient.chat.completions.create({
        model: config.aiModel,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: '请将以下对话历史压缩为一段简洁的中文摘要（200字以内），保留关键信息和用户偏好：\n\n' + text,
        }],
      })
      return resp.choices[0]?.message?.content ?? '（压缩失败）'
    } catch (err) {
      log.warn({ error: String(err) }, '对话压缩失败')
      return '（压缩失败）'
    }
  }
  const contextManager = new ContextManager(sessionRepo, memoryRepo, compressFn)

  const agentLoop = new AgentLoop(toolRegistry, sessionRepo, {
    apiKey: config.anthropicApiKey,
    baseURL: config.anthropicBaseUrl || undefined,
    defaultModel: config.aiModel,
  }, contextManager, memoryRepo)
  log.info({ tools: toolRegistry.getAll().map((t) => t.name) }, 'Agent 已初始化')

  // 当前活跃适配器（用于优雅关闭）
  let activeAdapter: CliAdapter | FeishuAdapter | null = null

  // 重试定时器（每 2 分钟扫描失败任务）
  let retryTimer: ReturnType<typeof setInterval> | null = null

  // 优雅关闭
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('正在优雅关闭...')
    try {
      if (retryTimer) clearInterval(retryTimer)
      if (activeAdapter) await activeAdapter.stop()
      await extractor.close()
      db.close()
      log.info('Webot 已关闭')
    } catch (error) {
      log.error({ error: String(error) }, '关闭过程出错')
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 启动重试队列扫描
  retryTimer = setInterval(async () => {
    try {
      const count = await pipeline.retryFailed()
      if (count > 0) {
        log.info({ retried: count }, '重试队列处理完成')
      }
    } catch (error) {
      log.warn({ error: String(error) }, '重试队列扫描出错')
    }
  }, 2 * 60 * 1000)

  if (config.cliMode) {
    // CLI 模式
    activeAdapter = new CliAdapter(pipeline, agentLoop)
    await activeAdapter.start()
  } else {
    // 飞书 WebSocket 模式
    activeAdapter = new FeishuAdapter(pipeline, config.feishuAppId, config.feishuAppSecret, agentLoop)
    await activeAdapter.start()

    // 注入飞书客户端到 DigestTool + 注册定时简报
    if (config.digestChatId) {
      digestTool.setFeishuClient(
        (activeAdapter as FeishuAdapter).getClient(),
        config.digestChatId,
      )

      // 定时简报 cron — 直接调用 DigestTool
      const noopResponder = {
        onProgress: async () => {},
        onComplete: async () => {},
        onError: async () => {},
      }
      cron.schedule(config.digestCron, async () => {
        try {
          await digestTool.execute({}, {
            sessionId: 'cron',
            chatId: config.digestChatId,
            userId: 'cron',
            responder: noopResponder as import('./responder/base.js').Responder,
          })
          log.info('定时简报执行完成')
        } catch (error) {
          log.error({ error: String(error) }, '定时简报执行失败')
        }
      })
      log.info({ cron: config.digestCron, chatId: config.digestChatId }, '每日简报定时任务已注册')
    }

    log.info('Webot 飞书模式已启动，按 Ctrl+C 退出')
  }
}

main().catch((error) => {
  log.fatal({ error: String(error) }, 'Webot 启动失败')
  process.exit(1)
})
