// 60s API 采集器 — 基于开源项目 vikiboss/60s
// 采集小红书热搜、每天60秒读懂世界、AI资讯快报

import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('60s-api')

/** 主域名（Deno Deploy，部分地区可能超时） */
const API_BASE = 'https://60s.viki.moe/v2'
/** 备用实例 */
const API_FALLBACK = 'https://60api.09cdn.xyz/v2'
/** 请求超时 ms */
const FETCH_TIMEOUT = 10_000

/** 60s API 通用响应 */
interface Api60sResponse<T> {
  code: number
  message: string
  data: T
}

/** 小红书热搜条目 */
interface RedNoteItem {
  rank: number
  title: string
  score: string
  link: string
  word_type: string
}

/** 60s 读懂世界 */
interface SixtySecondsData {
  date: string
  news: string[]
}

/**
 * 请求 60s API，主域名失败自动降级到备用实例
 */
async function fetchApi<T>(endpoint: string): Promise<T> {
  for (const base of [API_BASE, API_FALLBACK]) {
    const url = `${base}/${endpoint}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
    try {
      const resp = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!resp.ok) {
        log.warn({ url, status: resp.status }, '60s API 非 200 响应')
        continue
      }
      const json = (await resp.json()) as Api60sResponse<T>
      if (json.code !== 200 || !json.data) {
        log.warn({ url, code: json.code }, '60s API 业务错误')
        continue
      }
      return json.data
    } catch (err) {
      clearTimeout(timer)
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ url, err: msg }, '60s API 请求失败')
      continue
    }
  }
  throw new Error(`60s API ${endpoint} 全部实例失败`)
}

/**
 * 采集小红书热搜
 */
async function collectRedNote(): Promise<DigestItem[]> {
  const items = await fetchApi<RedNoteItem[]>('rednote')
  return items.map(item => ({
    title: item.title,
    url: item.link || `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.title)}`,
    source: 'xiaohongshu',
    extra: { score: item.score, type: item.word_type },
  }))
}

/**
 * 采集每天 60 秒读懂世界
 */
async function collect60sNews(): Promise<DigestItem[]> {
  const data = await fetchApi<SixtySecondsData>('60s')
  return data.news.map((text, i) => ({
    title: text,
    url: '',
    source: '60s-news',
    extra: { rank: String(i + 1) },
  }))
}

/**
 * 采集 AI 资讯快报
 */
async function collectAiNews(): Promise<DigestItem[]> {
  const data = await fetchApi<SixtySecondsData>('ai-news')
  if (!data.news || data.news.length === 0) {
    log.info('AI 资讯快报今日暂无数据')
    return []
  }
  return data.news.map((text, i) => ({
    title: text,
    url: '',
    source: 'ai-news-60s',
    extra: { rank: String(i + 1) },
  }))
}

/**
 * 60s API 整合采集 — 并行采集小红书 + 60s 世界 + AI 资讯
 */
export async function collect60sApi(): Promise<CollectorResult> {
  const start = Date.now()
  log.info('开始采集 60s API 组')

  const results = await Promise.allSettled([
    collectRedNote(),
    collect60sNews(),
    collectAiNews(),
  ])

  const allItems: DigestItem[] = []
  const errors: string[] = []

  const labels = ['小红书', '60s世界', 'AI资讯']
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allItems.push(...r.value)
      log.info({ source: labels[i], count: r.value.length }, '60s API 子源采集完成')
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      errors.push(`${labels[i]}: ${msg}`)
      log.warn({ source: labels[i], err: msg }, '60s API 子源采集失败')
    }
  })

  const duration = Date.now() - start
  log.info({ total: allItems.length, duration }, '60s API 组采集完成')

  return {
    name: '60s-api',
    items: allItems,
    duration,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}
