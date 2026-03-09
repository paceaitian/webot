import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ override: true })

import { loadConfig } from '../src/config.js'
import { ClaudeClient } from '../src/processor/claude-client.js'
import { DigestEngine } from '../src/digest/index.js'

const cfg = loadConfig()
const claude = new ClaudeClient(cfg.anthropicApiKey, cfg.anthropicBaseUrl)
const engine = new DigestEngine(claude, msg => console.log(`[进度] ${msg}`))

console.log('=== 每日简报 v2 测试 ===')
const digest = await engine.run()

console.log('\n=== 结果摘要 ===')
console.log(`日期: ${digest.date}`)
console.log(`分组数: ${digest.groups.length}`)
for (const g of digest.groups) {
  const items = g.channels.reduce((s: number, c: any) => s + c.items.length, 0)
  const chNames = g.channels.map((c: any) => `${c.channel.name}(${c.items.length})`).join(', ')
  console.log(`  ${g.config.label}: ${g.channels.length} 渠道, ${items} 条 — ${chNames}`)
}
console.log(`分析 quickRead 长度: ${digest.analysis.quickRead.length}`)
console.log(`总耗时: ${Math.round(digest.totalDuration / 1000)}s`)
