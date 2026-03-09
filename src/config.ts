// 环境变量配置加载与校验
import { config as dotenvConfig } from 'dotenv'
// override: .env 文件优先于系统环境变量
dotenvConfig({ override: true })

/** 应用配置 */
export interface AppConfig {
  /** 飞书应用 ID */
  feishuAppId: string
  /** 飞书应用密钥 */
  feishuAppSecret: string
  /** Anthropic API Key */
  anthropicApiKey: string
  /** Anthropic API 代理地址（可选） */
  anthropicBaseUrl: string
  /** Obsidian Vault 路径 */
  obsidianVaultPath: string
  /** SQLite 数据库路径 */
  dbPath: string
  /** 日志级别 */
  logLevel: string
  /** 是否 CLI 模式 */
  cliMode: boolean
  /** 每日简报 cron 表达式（默认 '0 9 * * *'） */
  digestCron: string
  /** 每日简报推送目标群 chat_id */
  digestChatId: string
  /** Serper API Key（可选，用于网络搜索） */
  serperApiKey: string
  /** AI 模型 ID（默认 glm-4.7） */
  aiModel: string
}

/**
 * 加载并校验环境变量，返回应用配置
 * CLI 模式下飞书配置可选
 */
export function loadConfig(): AppConfig {
  const cliMode = process.argv.includes('--cli')

  const config: AppConfig = {
    feishuAppId: process.env.FEISHU_APP_ID ?? '',
    feishuAppSecret: process.env.FEISHU_APP_SECRET ?? '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH ?? '',
    dbPath: process.env.DB_PATH ?? './data/webot.db',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    cliMode,
    digestCron: process.env.DIGEST_CRON ?? '0 9 * * *',
    digestChatId: process.env.DIGEST_CHAT_ID ?? '',
    serperApiKey: process.env.SERPER_API_KEY ?? '',
    aiModel: process.env.AI_MODEL ?? 'glm-4.7',
  }

  // 必须配置项校验
  const missing: string[] = []

  if (!config.anthropicApiKey) missing.push('ANTHROPIC_API_KEY')
  if (!config.obsidianVaultPath) missing.push('OBSIDIAN_VAULT_PATH')

  // 非 CLI 模式下飞书配置必须
  if (!cliMode) {
    if (!config.feishuAppId) missing.push('FEISHU_APP_ID')
    if (!config.feishuAppSecret) missing.push('FEISHU_APP_SECRET')
  }

  if (missing.length > 0) {
    throw new Error(`缺少必要环境变量: ${missing.join(', ')}`)
  }

  return config
}
