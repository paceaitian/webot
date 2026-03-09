// 诊断脚本：定位 scored_items JSON 解析错误的具体位置
import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ override: true })

import { ClaudeClient } from '../dist/processor/claude-client.js'
import { scoreSystemPrompt, scoreUserPrompt, scoreSchema } from '../dist/digest/prompts/score.js'
import { collectNewsNow } from '../dist/digest/collectors/newsnow.js'

const client = new ClaudeClient(
  process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_BASE_URL || undefined,
)

console.log('采集数据...')
const nn = await collectNewsNow('tech-news')
const batch = nn.items.slice(0, 25)
console.log('发送评分请求 (25 条)...')
const result = await client.scoreBatch(scoreSystemPrompt, scoreUserPrompt(batch), scoreSchema)

const si = result.scored_items
console.log('typeof:', typeof si)

if (typeof si === 'string') {
  console.log('字符串长度:', si.length)

  try {
    JSON.parse(si)
    console.log('JSON.parse 成功！')
  } catch (e) {
    const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '-1')
    console.log('JSON.parse 错误:', e.message)
    console.log('错误位置:', pos)
    if (pos > 0) {
      const around = si.slice(Math.max(0, pos - 100), pos + 50)
      console.log('错误附近内容:')
      console.log(around)
      console.log('---')
      // 找到问题字符
      console.log('pos 位置字符:', JSON.stringify(si[pos]), 'charCode:', si.charCodeAt(pos))
      console.log('pos-1 字符:', JSON.stringify(si[pos-1]), 'charCode:', si.charCodeAt(pos-1))
      console.log('pos-2 字符:', JSON.stringify(si[pos-2]), 'charCode:', si.charCodeAt(pos-2))
    }

    // 尝试宽容修复：替换可能的问题字符后再解析
    // 常见问题：中文引号、未转义的换行、截断
    let fixed = si
      .replace(/[\u201c\u201d]/g, '"')  // 中文引号
      .replace(/[\u2018\u2019]/g, "'")  // 中文单引号
      .replace(/\t/g, ' ')             // tab

    try {
      const parsed = JSON.parse(fixed)
      console.log('\n替换中文引号后解析成功:', Array.isArray(parsed), '条目:', parsed?.length)
    } catch (e2) {
      console.log('\n替换后仍失败:', e2.message)

      // 尝试逐条提取
      const items = []
      // 按 "index": N 分割
      const parts = si.split(/(?=\{\s*"index"\s*:)/)
      for (const part of parts) {
        let cleaned = part.trim()
        if (!cleaned.startsWith('{')) continue
        // 确保以 } 结尾
        const lastBrace = cleaned.lastIndexOf('}')
        if (lastBrace > 0) cleaned = cleaned.slice(0, lastBrace + 1)
        // 清理前导逗号
        if (cleaned.startsWith(',')) cleaned = cleaned.slice(1).trim()
        try {
          const obj = JSON.parse(cleaned)
          if (obj.index !== undefined) items.push(obj)
        } catch {}
      }
      console.log('\n逐条提取结果:', items.length, '/', batch.length, '条')
      if (items.length > 0) {
        console.log('第一条:', JSON.stringify(items[0]).slice(0, 200))
        console.log('最后一条:', JSON.stringify(items[items.length - 1]).slice(0, 200))
      }
    }
  }
} else if (Array.isArray(si)) {
  console.log('本次返回正常数组，条目数:', si.length)
} else {
  console.log('其他类型:', typeof si)
}
