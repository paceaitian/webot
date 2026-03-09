// 测试脚本：DeepSeek + GLM-4.7 评分对比
// 使用 OpenAI-compatible API 格式，与 Opus 评分结果对比

import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ override: true })

// 读取 model.txt 配置
import { readFileSync } from 'fs'
const modelLines = readFileSync('model.txt', 'utf-8').trim().split('\n')

const models = modelLines.map(line => {
  const parts = line.match(/\d+\s+(\S+)\s+"([^"]+)"\s+"([^"]+)"(?:\s+"([^"]+)")?/)
  if (!parts) return null
  return {
    baseUrl: parts[1],
    apiKey: parts[2],
    chatModel: parts[3],
    reasonerModel: parts[4] || null,
  }
}).filter(Boolean)

// 导入评分 prompt
import { scoreSystemPrompt, scoreUserPrompt, scoreSchema } from '../dist/digest/prompts/score.js'

// 采集少量真实数据用于测试
import { collectGhTrending } from '../dist/digest/collectors/gh-trending.js'
import { collectNewsNow } from '../dist/digest/collectors/newsnow.js'

// OpenAI-compatible API 调用
async function callOpenAI(baseUrl, apiKey, model, systemPrompt, userMessage, schema) {
  const tools = [{
    type: 'function',
    function: {
      name: 'score_items',
      description: '对资讯条目进行评分和摘要',
      parameters: schema,
    },
  }]

  const start = Date.now()
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        tools,
        tool_choice: { type: 'function', function: { name: 'score_items' } },
        max_tokens: 4096,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
    }

    const data = await resp.json()
    const duration = Date.now() - start
    const usage = data.usage || {}

    // 提取 tool_call 结果
    const msg = data.choices?.[0]?.message
    const toolCall = msg?.tool_calls?.[0]
    let result = null

    if (toolCall?.function?.arguments) {
      try {
        result = JSON.parse(toolCall.function.arguments)
      } catch {
        result = { raw: toolCall.function.arguments.slice(0, 500) }
      }
    } else if (msg?.content) {
      // 某些模型可能直接返回 JSON
      try {
        result = JSON.parse(msg.content)
      } catch {
        result = { raw: msg.content.slice(0, 500) }
      }
    }

    return { result, duration, usage, error: null }
  } catch (err) {
    return { result: null, duration: Date.now() - start, usage: {}, error: err.message }
  }
}

// 提取评分数组（复用 extractScoredArray 逻辑）
function extractScored(result) {
  if (!result) return null

  // 直接取 scored_items
  if (Array.isArray(result.scored_items)) return result.scored_items

  // 嵌套对象
  if (result.scored_items && typeof result.scored_items === 'object') {
    for (const val of Object.values(result.scored_items)) {
      if (Array.isArray(val) && val.length > 0 && val[0]?.index !== undefined) return val
    }
  }

  // 替代 key
  for (const key of ['items', 'scores', 'results', 'scored']) {
    if (Array.isArray(result[key])) return result[key]
  }

  // 任意含 index 的数组
  for (const [key, val] of Object.entries(result)) {
    if (Array.isArray(val) && val.length > 0 && val[0]?.index !== undefined) return val
  }

  return null
}

// 评估评分质量
function evaluateQuality(scored, batchSize) {
  if (!scored || scored.length === 0) return { coverage: 0, avgScore: 0, hasTitles: false, hasCategories: false, scoreVariance: 0 }

  const coverage = scored.length / batchSize
  const avgScore = scored.reduce((s, i) => s + (i.relevance || 0) + (i.quality || 0) + (i.timeliness || 0), 0) / scored.length / 3
  const hasTitles = scored.every(i => i.ai_title && i.ai_title.length > 2)
  const hasCategories = scored.every(i => i.category)

  // 评分区分度（标准差）
  const allScores = scored.flatMap(i => [i.relevance, i.quality, i.timeliness]).filter(Boolean)
  const mean = allScores.reduce((s, v) => s + v, 0) / allScores.length
  const variance = allScores.reduce((s, v) => s + (v - mean) ** 2, 0) / allScores.length

  return { coverage, avgScore, hasTitles, hasCategories, scoreVariance: Math.sqrt(variance) }
}

console.log('=== 模型评分对比测试 ===')
console.log(`开始时间: ${new Date().toISOString()}`)
console.log()

// 采集测试数据
console.log('采集测试数据...')
const [gh, nn] = await Promise.all([
  collectGhTrending().catch(() => ({ name: 'gh', items: [], duration: 0 })),
  collectNewsNow('tech-news').catch(() => ({ name: 'nn', items: [], duration: 0 })),
])

const testItems = [...gh.items.slice(0, 5), ...nn.items.slice(0, 5)]
console.log(`测试数据: ${testItems.length} 条 (GitHub ${gh.items.length} + NewsNow ${nn.items.length})`)

if (testItems.length < 3) {
  console.error('测试数据不足，退出')
  process.exit(1)
}

const userMsg = scoreUserPrompt(testItems)
console.log(`Prompt 长度: ${userMsg.length} 字符`)
console.log()

// 测试各模型
const results = []

for (const modelConfig of models) {
  // 测试 chat 模型
  console.log(`--- ${modelConfig.chatModel} ---`)
  console.log(`  base: ${modelConfig.baseUrl}`)

  const chatResult = await callOpenAI(
    modelConfig.baseUrl, modelConfig.apiKey,
    modelConfig.chatModel, scoreSystemPrompt, userMsg, scoreSchema,
  )

  if (chatResult.error) {
    console.log(`  错误: ${chatResult.error}`)
  } else {
    const scored = extractScored(chatResult.result)
    const quality = evaluateQuality(scored, testItems.length)
    console.log(`  耗时: ${chatResult.duration}ms`)
    console.log(`  tokens: in=${chatResult.usage.prompt_tokens || '?'} out=${chatResult.usage.completion_tokens || '?'}`)
    console.log(`  提取成功: ${scored ? scored.length + ' 条' : '失败'}`)
    if (scored) {
      console.log(`  覆盖率: ${(quality.coverage * 100).toFixed(0)}%`)
      console.log(`  平均分: ${quality.avgScore.toFixed(1)}`)
      console.log(`  区分度(σ): ${quality.scoreVariance.toFixed(2)}`)
      console.log(`  中文标题: ${quality.hasTitles ? '✓' : '✗'}`)
      console.log(`  分类标注: ${quality.hasCategories ? '✓' : '✗'}`)
      // 展示前 3 条
      console.log(`  示例:`)
      for (const item of scored.slice(0, 3)) {
        console.log(`    [${item.relevance}/${item.quality}/${item.timeliness}] ${item.ai_title} (${item.category})`)
      }
    }
    results.push({ model: modelConfig.chatModel, ...chatResult, scored, quality })
  }
  console.log()

  // 测试 reasoner 模型（如有）
  if (modelConfig.reasonerModel) {
    console.log(`--- ${modelConfig.reasonerModel} ---`)
    const reasonerResult = await callOpenAI(
      modelConfig.baseUrl, modelConfig.apiKey,
      modelConfig.reasonerModel, scoreSystemPrompt, userMsg, scoreSchema,
    )

    if (reasonerResult.error) {
      console.log(`  错误: ${reasonerResult.error}`)
    } else {
      const scored = extractScored(reasonerResult.result)
      const quality = evaluateQuality(scored, testItems.length)
      console.log(`  耗时: ${reasonerResult.duration}ms`)
      console.log(`  tokens: in=${reasonerResult.usage.prompt_tokens || '?'} out=${reasonerResult.usage.completion_tokens || '?'}`)
      console.log(`  提取成功: ${scored ? scored.length + ' 条' : '失败'}`)
      if (scored) {
        console.log(`  覆盖率: ${(quality.coverage * 100).toFixed(0)}%`)
        console.log(`  平均分: ${quality.avgScore.toFixed(1)}`)
        console.log(`  区分度(σ): ${quality.scoreVariance.toFixed(2)}`)
        console.log(`  中文标题: ${quality.hasTitles ? '✓' : '✗'}`)
        console.log(`  分类标注: ${quality.hasCategories ? '✓' : '✗'}`)
        console.log(`  示例:`)
        for (const item of scored.slice(0, 3)) {
          console.log(`    [${item.relevance}/${item.quality}/${item.timeliness}] ${item.ai_title} (${item.category})`)
        }
      }
      results.push({ model: modelConfig.reasonerModel, ...reasonerResult, scored, quality })
    }
    console.log()
  }
}

// 同时用 Opus 评一遍做对照
console.log('--- Opus (对照组) ---')
import { ClaudeClient } from '../dist/processor/claude-client.js'
const claude = new ClaudeClient(
  process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_BASE_URL || undefined,
)

const opusStart = Date.now()
try {
  const opusResult = await claude.scoreBatch(scoreSystemPrompt, userMsg, scoreSchema)
  const opusDuration = Date.now() - opusStart
  const opusScored = extractScored(opusResult)
  const opusQuality = evaluateQuality(opusScored, testItems.length)
  console.log(`  耗时: ${opusDuration}ms`)
  console.log(`  提取成功: ${opusScored ? opusScored.length + ' 条' : '失败'}`)
  if (opusScored) {
    console.log(`  覆盖率: ${(opusQuality.coverage * 100).toFixed(0)}%`)
    console.log(`  平均分: ${opusQuality.avgScore.toFixed(1)}`)
    console.log(`  区分度(σ): ${opusQuality.scoreVariance.toFixed(2)}`)
    console.log(`  中文标题: ${opusQuality.hasTitles ? '✓' : '✗'}`)
    console.log(`  分类标注: ${opusQuality.hasCategories ? '✓' : '✗'}`)
    console.log(`  示例:`)
    for (const item of opusScored.slice(0, 3)) {
      console.log(`    [${item.relevance}/${item.quality}/${item.timeliness}] ${item.ai_title} (${item.category})`)
    }
  } else {
    console.log(`  结果格式:`, JSON.stringify(opusResult).slice(0, 300))
  }
  results.push({ model: 'claude-opus-4-6', duration: opusDuration, scored: opusScored, quality: opusQuality })
} catch (err) {
  console.log(`  错误: ${err.message}`)
}

console.log()
console.log('=== 对比汇总 ===')
console.log('模型 | 耗时 | 覆盖率 | 平均分 | 区分度 | 标题 | 分类')
console.log('---|---|---|---|---|---|---')
for (const r of results) {
  const q = r.quality || {}
  console.log(`${r.model} | ${r.duration}ms | ${((q.coverage || 0) * 100).toFixed(0)}% | ${(q.avgScore || 0).toFixed(1)} | ${(q.scoreVariance || 0).toFixed(2)} | ${q.hasTitles ? '✓' : '✗'} | ${q.hasCategories ? '✓' : '✗'}`)
}
