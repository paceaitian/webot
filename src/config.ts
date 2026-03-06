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
