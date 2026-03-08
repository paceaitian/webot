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
import { AgentLoop } from './agent/loop.js'
import { CliAdapter } from './adapters/cli.js'
import { FeishuAdapter } from './adapters/feishu.js'
import { createLogger } from './utils/logger.js'
import cron from 'node-cron'
import { DigestEngine } from './digest/index.js'
import { buildDigestCard, writeDigestToObsidian } from './digest/reporter.js'

const log = createLogger('main')

/** 执行每日简报并推送 */
async function runDigest(
  digestEngine: DigestEngine,
  feishuClient: import('@larksuiteoapi/node-sdk').Client,
  chatId: string,
  vaultPath: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const dlog = createLogger('digest-runner')
  try {
    dlog.info('开始执行每日简报...')
    // 动态注入 onProgress 回调到 DigestEngine
    digestEngine.setOnProgress(onProgress)
    const digest = await digestEngine.run()

    // 发送飞书卡片
    const card = buildDigestCard(digest)
    const cardResp = await feishuClient.cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(card) },
    })
    const cardId = cardResp.data?.card_id
    if (cardId) {
      await feishuClient.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
        },
      })
      dlog.info({ cardId }, '简报卡片已发送')
    }

    // 写入 Obsidian
    const filePath = await writeDigestToObsidian(digest, vaultPath)
    dlog.info({ filePath }, '简报已存档到 Obsidian')
  } catch (error) {
    dlog.error({ error: String(error) }, '每日简报执行失败')
  }
}

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
  const processor = new AIProcessor(config.anthropicApiKey, config.anthropicBaseUrl || undefined)

  // 构建管道引擎
  const pipeline = new PipelineEngine(messageRepo, jobRepo, extractor, processor, writer)

  // 初始化 Agent 组件
  const sessionRepo = new SessionRepo(db.db)
  const toolRegistry = new ToolRegistry()
  toolRegistry.register(new SaveTool(pipeline))
  const agentLoop = new AgentLoop(toolRegistry, sessionRepo, {
    apiKey: config.anthropicApiKey,
    baseURL: config.anthropicBaseUrl || undefined,
  })
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

    // 每日简报
    if (config.digestChatId) {
      const feishuAdapter = activeAdapter as FeishuAdapter
      const digestEngine = new DigestEngine(processor.getClaudeClient())

      // 注入 #digest 处理器
      feishuAdapter.setDigestHandler(async (onProgress) => {
        await runDigest(digestEngine, feishuAdapter.getClient(), config.digestChatId, config.obsidianVaultPath, onProgress)
      })

      // 注册定时任务
      cron.schedule(config.digestCron, () => {
        runDigest(digestEngine, feishuAdapter.getClient(), config.digestChatId, config.obsidianVaultPath)
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
