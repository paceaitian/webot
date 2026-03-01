// Webot 主入口 — CLI / 飞书模式
import { loadConfig } from './config.js'
import { AppDatabase } from './db/database.js'
import { MessageRepo } from './db/repositories/message-repo.js'
import { JobRepo } from './db/repositories/job-repo.js'
import { PipelineEngine } from './pipeline/engine.js'
import { ContentExtractor } from './extractor/index.js'
import { AIProcessor } from './processor/index.js'
import { ObsidianWriter } from './writer/obsidian-writer.js'
import { CliAdapter } from './adapters/cli.js'
import { FeishuAdapter } from './adapters/feishu.js'
import { createLogger } from './utils/logger.js'

const log = createLogger('main')

async function main() {
  const config = loadConfig()

  log.info({ cliMode: config.cliMode }, 'Webot 启动中...')

  // 初始化数据库
  const db = new AppDatabase(config.dbPath)
  const messageRepo = new MessageRepo(db.db)
  const jobRepo = new JobRepo(db.db)

  // 初始化 Writer（用于获取附件目录）
  const writer = new ObsidianWriter(config.obsidianVaultPath)

  // 初始化 Extractor（传入附件目录供图片下载）
  const extractor = new ContentExtractor(writer.getAttachmentDir())

  // 初始化 AI Processor
  const processor = new AIProcessor(config.anthropicApiKey, config.anthropicBaseUrl || undefined)

  // 构建管道引擎
  const pipeline = new PipelineEngine(messageRepo, jobRepo, extractor, processor, writer)

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
    activeAdapter = new CliAdapter(pipeline)
    await activeAdapter.start()
  } else {
    // 飞书 WebSocket 模式
    activeAdapter = new FeishuAdapter(pipeline, config.feishuAppId, config.feishuAppSecret)
    await activeAdapter.start()
    log.info('Webot 飞书模式已启动，按 Ctrl+C 退出')
  }
}

main().catch((error) => {
  log.fatal({ error: String(error) }, 'Webot 启动失败')
  process.exit(1)
})
