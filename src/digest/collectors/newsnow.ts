// 多平台热点采集器 — 基于 NewsNow API（/api/s?id=xxx&latest）
// 参考 mycc collect 实现，覆盖中英文技术社区和社交平台

import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('newsnow')

/** NewsNow API 端点（注意是 /api/s 不是 /api） */
const API_BASE = 'https://newsnow.busiyi.world/api/s'
/** 请求超时 ms */
const FETCH_TIMEOUT = 10_000
/** 浏览器 UA — 避免 Cloudflare 拦截 */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

/** NewsNow API 返回的单条数据 */
interface NewsNowItem {
  title: string
  url: string
  mobileUrl?: string
}

/** 源 ID 到显示名称的映射 */
const PLATFORM_NAMES: Record<string, string> = {
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
 * 采集指定组的全部数据源
 */
export async function collectNewsNow(
  group: keyof typeof GROUPS | string,
): Promise<CollectorResult> {
  const start = Date.now()
  const sourceIds = GROUPS[group]
  if (!sourceIds) {
    return { name: `newsnow-${group}`, items: [], duration: Date.now() - start, error: `未知分组: ${group}` }
  }

  log.info({ group, sources: sourceIds }, '开始采集 NewsNow 组')

  const allItems: DigestItem[] = []
  const errors: string[] = []

  const results = await Promise.allSettled(
    sourceIds.map(id => fetchPlatform(id)),
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
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}

/** 请求单个平台，取前 10 条 */
async function fetchPlatform(platformId: string, limit = 10): Promise<DigestItem[]> {
  const url = `${API_BASE}?id=${platformId}&latest`
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

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
      log.warn({ platformId, contentType }, 'NewsNow 返回非 JSON，跳过')
      return []
    }

    const data = (await resp.json()) as { items?: NewsNowItem[] }
    const items = (data.items ?? []).slice(0, limit)
    const sourceName = PLATFORM_NAMES[platformId] ?? platformId

    return items.map(item => ({
      title: item.title || '无标题',
      url: item.url || item.mobileUrl || '',
      source: sourceName,
    }))
  } finally {
    clearTimeout(timer)
  }
}
