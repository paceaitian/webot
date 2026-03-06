// NewsNow 新闻聚合采集器 — 调用 NewsNow API 获取 tech-news / trends / xhs 三组数据

import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('newsnow')

/** NewsNow API 基地址 */
const BASE_URL = 'https://newsnow.busiyi.world/api'
/** 请求超时 ms */
const FETCH_TIMEOUT = 15_000
/** User-Agent 标识 */
const USER_AGENT = 'webot/0.1'

/** NewsNow API 返回的单条数据 */
interface NewsNowItem {
  id: string | number
  title: string
  url: string
  mobileUrl?: string
  pubDate?: number | string
  extra?: {
    hover?: string
    date?: number | string
    info?: false | string
    diff?: number
    icon?: false | string | { url: string; scale: number }
  }
}

/** 源 ID 到显示名称的映射 */
const SOURCE_NAMES: Record<string, string> = {
  hackernews: 'Hacker News',
  producthunt: 'Product Hunt',
  v2ex: 'V2EX',
  weibo: '微博热搜',
  zhihu: '知乎热榜',
  douyin: '抖音热榜',
  xiaohongshu: '小红书',
}

/** 三个采集组定义 */
const GROUPS: Record<string, string[]> = {
  'tech-news': ['hackernews', 'producthunt', 'v2ex'],
  'trends': ['weibo', 'zhihu', 'douyin'],
  'xhs': ['xiaohongshu'],
}

/**
 * 采集 NewsNow 指定组的全部数据源
 * @param group - 组名: tech-news / trends / xhs
 */
export async function collectNewsNow(
  group: keyof typeof GROUPS | string,
): Promise<CollectorResult> {
  const start = Date.now()
  const sourceIds = GROUPS[group]
  if (!sourceIds) {
    return {
      name: `newsnow-${group}`,
      items: [],
      duration: Date.now() - start,
      error: `未知分组: ${group}`,
    }
  }

  log.info({ group, sources: sourceIds }, '开始采集 NewsNow 组')

  const allItems: DigestItem[] = []
  const errors: string[] = []

  // 全量并发请求每个源
  const results = await Promise.allSettled(
    sourceIds.map(id => fetchNewsNowSource(id)),
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const sourceId = sourceIds[i]
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    } else {
      const msg = `${sourceId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      errors.push(msg)
      log.warn({ source: sourceId, err: msg }, 'NewsNow 源采集失败')
    }
  }

  const duration = Date.now() - start
  log.info({ group, count: allItems.length, duration }, 'NewsNow 组采集完成')

  return {
    name: `newsnow-${group}`,
    items: allItems,
    duration,
    error: errors.length > 0 ? `${errors.length} 个源失败: ${errors.join('; ')}` : undefined,
  }
}

/**
 * 请求单个 NewsNow 数据源
 * @param sourceId - 源标识（如 hackernews, weibo）
 */
async function fetchNewsNowSource(sourceId: string): Promise<DigestItem[]> {
  const url = `${BASE_URL}/${sourceId}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
      // 降级处理：API 返回非 JSON（如 HTML 错误页）
      log.warn({ sourceId, contentType }, 'NewsNow 返回非 JSON，跳过')
      return []
    }

    const data: unknown = await resp.json()
    const items = extractItems(data)
    const sourceName = SOURCE_NAMES[sourceId] ?? sourceId

    return items.map(item => toDigestItem(item, sourceName))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 API 响应中提取条目数组，兼容多种响应结构
 * - 直接数组: NewsNowItem[]
 * - 包裹对象: { data: NewsNowItem[] } 或 { items: NewsNowItem[] }
 */
function extractItems(data: unknown): NewsNowItem[] {
  if (Array.isArray(data)) return data as NewsNowItem[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data as NewsNowItem[]
    if (Array.isArray(obj.items)) return obj.items as NewsNowItem[]
  }
  return []
}

/** 将 NewsNow 条目转为 DigestItem */
function toDigestItem(item: NewsNowItem, sourceName: string): DigestItem {
  const publishedAt = resolveDate(item.pubDate ?? item.extra?.date)

  return {
    title: item.title,
    url: item.url,
    source: sourceName,
    description: typeof item.extra?.hover === 'string' ? item.extra.hover : undefined,
    publishedAt,
    extra: typeof item.extra?.info === 'string' ? { info: item.extra.info } : undefined,
  }
}

/** 解析日期字段（支持时间戳和字符串） */
function resolveDate(raw: number | string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'number') {
    // 毫秒级时间戳
    const ts = raw > 1e12 ? raw : raw * 1000
    return new Date(ts).toISOString()
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }
  return undefined
}
