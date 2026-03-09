// 每日简报 v2 输出层 — 飞书 CardKit v2 分组卡片 + Obsidian Vault 按渠道存档

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'
import type { DailyDigestV2, ScoredItem, ChannelDigest } from './collectors/types.js'

const log = createLogger('digest-reporter')

/** 渠道名称对应的标签颜色 */
const CHANNEL_COLORS: Record<string, string> = {
  'Hacker News': 'orange', 'Product Hunt': 'red', 'GitHub Trending': 'purple',
  'V2EX': 'green', 'RSS 精选': 'blue',
  '微博热搜': 'red', '知乎热榜': 'blue', '抖音热榜': 'grey',
  '小红书': 'red', '虎扑': 'orange', '百度贴吧': 'blue', '今日头条': 'red',
  '36氪': 'blue', 'IT之家': 'red', '酷安': 'green', '澎湃新闻': 'red',
  '华尔街见闻': 'blue', '财联社': 'red', 'MKTNews': 'blue',
}

/**
 * 构建每日简报飞书 v2 schema CardKit 分组卡片
 * @param digest - v2 完整简报数据
 * @returns 卡片 JSON 对象（schema 2.0）
 */
export function buildDigestCard(digest: DailyDigestV2): Record<string, unknown> {
  const { date, groups, analysis, collections, totalDuration } = digest
  const sourceCount = collections.filter(c => !c.error || c.items.length > 0).length
  const totalArticles = groups.reduce((sum, g) => sum + g.channels.reduce((s, c) => s + c.items.length, 0), 0)

  const header = {
    title: { tag: 'plain_text', content: `每日简报 — ${date}` },
    template: 'indigo',
    text_tag_list: [
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${sourceCount} 源` }, color: 'blue' },
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${totalArticles} 条` }, color: 'turquoise' },
    ],
  }

  const elements: Record<string, unknown>[] = []

  // 30 秒速读
  if (analysis.quickRead) {
    const techGroup = groups.find(g => g.config.id === 'tech')
    const techCount = techGroup ? techGroup.channels.reduce((s, c) => s + c.items.length, 0) : 0
    const note = techCount > 0 ? `<font color='grey'>基于 ${techCount} 条技术精选的 AI 分析</font>\n\n` : ''
    elements.push({ tag: 'markdown', content: `**30 秒速读**\n\n${note}${analysis.quickRead}` })
  }

  // 按分组渲染
  for (const group of groups) {
    if (group.channels.length === 0) continue

    elements.push({ tag: 'hr' })
    elements.push({ tag: 'markdown', content: `## ${group.config.label}` })

    for (const cd of group.channels) {
      const color = CHANNEL_COLORS[cd.channel.name] ?? 'grey'
      const countLabel = cd.channel.scored ? `AI 评分 Top ${cd.items.length}` : `Top ${cd.items.length}`

      // 渠道标题
      elements.push({
        tag: 'column_set', horizontal_align: 'left',
        columns: [{
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{ tag: 'markdown', content: `**${cd.channel.name}** <font color='${color}'>${countLabel}</font>` }],
        }],
      })

      // 渠道条目
      elements.push({ tag: 'markdown', content: buildChannelItemsMd(cd) })
    }
  }

  // 底部元信息
  elements.push({ tag: 'hr' })
  const minutes = Math.round(totalDuration / 60_000)
  const channelCount = groups.reduce((s, g) => s + g.channels.length, 0)
  elements.push({
    tag: 'markdown',
    content: `<font color='grey'>${channelCount} 渠道 | ${totalArticles} 条 | Opus | ${minutes}min</font>`,
  })

  return { schema: '2.0', config: { update_multi: true }, header, body: { direction: 'vertical', elements } }
}

/**
 * 单个渠道的条目列表 Markdown
 */
function buildChannelItemsMd(cd: ChannelDigest): string {
  return cd.items.map((item, i) => {
    // 技术渠道（已评分）：显示 AI 标题 + 摘要
    if (cd.channel.scored && isScoredItem(item)) {
      if (cd.channel.id === 'github-trending') {
        const stars = item.extra?.starsToday ?? ''
        const desc = item.description ? `\n   ${item.description}` : ''
        return `${i + 1}. [${item.title}](${item.url})${stars ? ` ⭐ ${stars} today` : ''}${desc}`
      }
      return `${i + 1}. [**${item.aiTitle ?? item.title}**](${item.url}) — ${item.source}\n   ${item.aiSummary ?? ''}`
    }
    // 非技术渠道：直接原标题
    return `${i + 1}. [${item.title}](${item.url})`
  }).join('\n')
}

/** 类型守卫：判断是否为 ScoredItem */
function isScoredItem(item: unknown): item is ScoredItem {
  return typeof item === 'object' && item !== null && 'aiTitle' in item
}

/**
 * 将每日简报写入 Obsidian Vault（按渠道分组）
 * @param digest - v2 完整简报数据
 * @param vaultPath - Obsidian Vault 根路径
 * @returns 写入的文件绝对路径
 */
export async function writeDigestToObsidian(
  digest: DailyDigestV2,
  vaultPath: string,
): Promise<string> {
  const { date, groups, analysis } = digest

  const sections: string[] = []

  // Frontmatter
  const channelCount = groups.reduce((s, g) => s + g.channels.length, 0)
  const totalArticles = groups.reduce((sum, g) => sum + g.channels.reduce((s, c) => s + c.items.length, 0), 0)
  sections.push(`---\ntype: digest\ndate: ${date}\nchannels: ${channelCount}\narticles: ${totalArticles}\n---`)
  sections.push(`# 每日简报 — ${date}`)

  // 30 秒速读
  sections.push('## 30 秒速读')
  sections.push(analysis.quickRead || '暂无')

  // 按分组输出
  for (const group of groups) {
    if (group.channels.length === 0) continue
    sections.push(`## ${group.config.label}`)

    for (const cd of group.channels) {
      sections.push(`### ${cd.channel.name}`)
      if (cd.channel.scored) {
        // 技术渠道：表格含评分
        sections.push('| # | 标题 | 来源 | 分类 | 评分 |')
        sections.push('|---|------|------|------|------|')
        cd.items.forEach((item, i) => {
          if (isScoredItem(item)) {
            const t = (item.aiTitle ?? item.title).replace(/\|/g, '\\|')
            sections.push(`| ${i + 1} | [${t}](${item.url}) | ${item.source} | ${item.category} | ${item.totalScore} |`)
          } else {
            sections.push(`| ${i + 1} | [${item.title}](${item.url}) | ${item.source} | - | - |`)
          }
        })
      } else {
        // 非技术渠道：简单列表
        cd.items.forEach((item, i) => {
          sections.push(`${i + 1}. [${item.title}](${item.url})`)
        })
      }
      sections.push('')
    }
  }

  // 跨源关联 + 行动项
  if (analysis.correlations) {
    sections.push('## 跨源关联')
    sections.push(analysis.correlations)
  }
  if (analysis.actionItems) {
    sections.push('## 行动项')
    sections.push(analysis.actionItems)
  }

  const content = sections.join('\n\n')
  const filePath = `${vaultPath}/digest/${date}.md`
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  log.info({ filePath, size: content.length }, '简报已写入 Obsidian')
  return filePath
}

/**
 * 格式化 ScoredItem 为简短文本（用于日志/调试）
 */
export function formatScoredItem(item: ScoredItem): string {
  return `[${item.category ?? '未分类'}] ${item.aiTitle ?? item.title} (${item.totalScore}分) — ${item.source}`
}
