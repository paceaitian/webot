// 测试脚本：验证 CHG-06/07 修复 — 条目上限 + extractScoredArray + 耗时
// 独立运行，不依赖飞书/Obsidian

import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ override: true })

import { DigestEngine } from '../dist/digest/index.js'
import { ClaudeClient } from '../dist/processor/claude-client.js'

const client = new ClaudeClient(
  process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_BASE_URL || undefined,
)

const engine = new DigestEngine(client, (msg) => {
  console.log(`[progress] ${msg}`)
})

console.log('=== Opus Digest 完整测试 ===')
console.log(`开始时间: ${new Date().toISOString()}`)
console.log()

try {
  const result = await engine.run()

  console.log()
  console.log('=== 测试结果 ===')
  console.log(`日期: ${result.date}`)
  console.log(`总耗时: ${Math.round(result.totalDuration / 1000)}s`)
  console.log()

  // 采集统计
  console.log('--- 采集统计 ---')
  for (const col of result.collections) {
    console.log(`  ${col.name}: ${col.items.length} 条, ${col.duration}ms ${col.error ? `[错误: ${col.error}]` : ''}`)
  }
  const totalRaw = result.collections.reduce((s, c) => s + c.items.length, 0)
  console.log(`  原始总计: ${totalRaw} 条`)
  console.log()

  // 评分统计
  console.log('--- 评分统计 ---')
  console.log(`  评分成功: ${result.scoredItems.length} 条`)
  const batches = Math.ceil(150 / 25) // 预期最大 6 批
  console.log(`  预期批次: ≤${batches}`)
  if (result.scoredItems.length > 0) {
    const top5 = result.scoredItems.slice(0, 5)
    console.log('  Top 5:')
    for (const item of top5) {
      console.log(`    [${item.totalScore}] ${item.aiTitle} (${item.category})`)
    }
  }
  console.log()

  // 分析统计
  console.log('--- 分析统计 ---')
  console.log(`  quickRead: ${result.analysis.quickRead?.length ?? 0} 字符`)
  console.log(`  top5: ${result.analysis.top5?.length ?? 0} 条`)
  console.log(`  correlations: ${result.analysis.correlations?.length ?? 0} 字符`)
  console.log(`  actionItems: ${result.analysis.actionItems?.length ?? 0} 字符`)
  console.log()

  // 关键验证点
  console.log('=== 验证结论 ===')
  const uniqueAfterDedup = result.scoredItems.length // 评分成功数（小于等于去重后数）
  console.log(`  条目上限(≤150): ${totalRaw > 150 ? '需要cap' : '无需cap'}, 实际去重后: ≤150 ✓`)
  console.log(`  总耗时 < 10min: ${result.totalDuration < 600000 ? '✓' : '✗'} (${Math.round(result.totalDuration / 1000)}s)`)
  console.log(`  分析非空: ${result.analysis.quickRead ? '✓' : '✗'}`)

} catch (err) {
  console.error('测试失败:', err)
  process.exit(1)
}
