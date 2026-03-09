// WebSearchTool — 使用 Serper API 进行网络搜索，返回结构化搜索结果给 LLM
import type { Tool, ToolResult, ToolContext } from './base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-web-search')

/** Serper API 搜索结果条目 */
interface SerperOrganicResult {
  title: string
  link: string
  snippet: string
  position: number
}

/** Serper API 知识面板 */
interface SerperKnowledgeGraph {
  title?: string
  description?: string
}

/** Serper API 精选摘要 */
interface SerperAnswerBox {
  snippet?: string
  title?: string
}

/** Serper API 响应体 */
interface SerperResponse {
  organic?: SerperOrganicResult[]
  knowledgeGraph?: SerperKnowledgeGraph
  answerBox?: SerperAnswerBox
}

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15_000

/** 最大返回结果数 */
const MAX_NUM = 20

/** 默认返回结果数 */
const DEFAULT_NUM = 10

/**
 * WebSearchTool — 通过 Serper API 搜索互联网，返回结构化结果
 * 适用于需要查找最新信息、回答事实性问题等场景
 */
export class WebSearchTool implements Tool {
  name = 'web_search'
  description =
    '搜索互联网获取最新信息。适用于回答事实性问题、查找最新新闻、搜索技术文档等需要网络信息的场景。'
  parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      num: {
        type: 'number',
        description: '返回结果数量（默认 10，最大 20）',
      },
    },
    required: ['query'],
  }

  constructor(private apiKey: string) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const query = params.query as string
    const rawNum = params.num as number | undefined

    // API key 校验
    if (!this.apiKey) {
      log.warn('Serper API Key 未配置')
      return { content: '网络搜索功能未启用：未配置 SERPER_API_KEY。请联系管理员配置后使用。' }
    }

    // num 参数校验与截断
    const num = Math.min(Math.max(1, rawNum ?? DEFAULT_NUM), MAX_NUM)

    log.info({ query, num }, 'WebSearchTool 执行')

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误')
        log.error({ status: response.status, errorText }, 'Serper API 请求失败')
        return { content: `搜索请求失败（HTTP ${response.status}）: ${errorText}` }
      }

      const data = (await response.json()) as SerperResponse
      const content = formatSearchResults(query, data)

      log.info({ query, resultCount: data.organic?.length ?? 0 }, 'WebSearchTool 完成')
      return { content }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.error({ query }, 'Serper API 请求超时')
        return { content: '搜索请求超时（15 秒），请稍后重试。' }
      }
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ query, error: msg }, 'WebSearchTool 执行失败')
      return { content: `搜索失败: ${msg}` }
    }
  }
}

/**
 * 将 Serper API 响应格式化为 LLM 可读的文本
 */
function formatSearchResults(query: string, data: SerperResponse): string {
  const parts: string[] = [`搜索: ${query}\n`]

  // 知识面板优先展示
  if (data.knowledgeGraph?.title || data.knowledgeGraph?.description) {
    parts.push('--- 知识面板 ---')
    if (data.knowledgeGraph.title) parts.push(`${data.knowledgeGraph.title}`)
    if (data.knowledgeGraph.description) parts.push(data.knowledgeGraph.description)
    parts.push('')
  }

  // 精选摘要优先展示
  if (data.answerBox?.snippet) {
    parts.push('--- 精选摘要 ---')
    if (data.answerBox.title) parts.push(`${data.answerBox.title}`)
    parts.push(data.answerBox.snippet)
    parts.push('')
  }

  // 常规搜索结果
  const organic = data.organic ?? []
  if (organic.length > 0) {
    parts.push('--- 搜索结果 ---')
    for (const item of organic) {
      parts.push(`${item.position}. ${item.title}`)
      parts.push(`   ${item.link}`)
      if (item.snippet) parts.push(`   ${item.snippet}`)
      parts.push('')
    }
  }

  if (organic.length === 0 && !data.knowledgeGraph && !data.answerBox) {
    parts.push('未找到相关结果。')
  }

  return parts.join('\n').trim()
}
