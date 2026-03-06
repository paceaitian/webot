// 每日简报输出层 — 飞书 CardKit v2 卡片构建 + Obsidian Vault 存档写入

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'
import type { DailyDigest, ScoredItem } from './collectors/types.js'

const log = createLogger('digest-reporter')

/**
 * 构建每日简报飞书 v2 schema CardKit 卡片
 * @param digest - 完整的每日简报数据
 * @returns 卡片 JSON 对象（schema 2.0）
 */
export function buildDigestCard(digest: DailyDigest): Record<string, unknown> {
  const { date, collections, scoredItems, analysis, totalDuration } = digest
  const sourceCount = collections.filter(c => !c.error || c.items.length > 0).length
  const articleCount = scoredItems.length

  // --- Header ---
  const header: Record<string, unknown> = {
    title: { tag: 'plain_text', content: `每日简报 — ${date}` },
    template: 'indigo',
    text_tag_list: [
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${sourceCount} 源` }, color: 'blue' },
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${articleCount} 入选` }, color: 'turquoise' },
    ],
  }

  // --- Body elements ---
  const elements: Record<string, unknown>[] = []

  // 30 秒速读
  if (analysis.quickRead) {
    elements.push({
      tag: 'markdown',
      content: `**🔭 30 秒速读**\n\n${analysis.quickRead}`,
    })
  }

  elements.push({ tag: 'hr' })

  // 今日必读 Top 5
  elements.push({
    tag: 'markdown',
    content: '**📌 今日必读**',
  })

  for (const { item, reason } of analysis.top5) {
    // 标题 + 摘要 + 推荐理由
    const articleMd = [
      `**${item.aiTitle}**`,
      item.aiSummary,
      reason !== item.aiSummary ? `> 💡 ${reason}` : '',
    ].filter(Boolean).join('\n')

    elements.push({ tag: 'markdown', content: articleMd })

    // 两列按钮：查看原文 + 收藏到 Obsidian
    elements.push({
      tag: 'column_set',
      horizontal_align: 'left',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_spacing: '8px',
          horizontal_align: 'left',
          vertical_align: 'top',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '查看原文' },
            type: 'primary_filled',
            size: 'small',
            width: 'fill',
            behaviors: [{ type: 'open_url', default_url: item.url }],
          }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_spacing: '8px',
          horizontal_align: 'left',
          vertical_align: 'top',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '收藏到 Obsidian' },
            type: 'primary_filled',
            size: 'small',
            width: 'fill',
            behaviors: [{ type: 'callback', value: { command: 'save', url: item.url } }],
          }],
        },
      ],
    })
  }

  elements.push({ tag: 'hr' })

  // 跨源关联（如有）
  if (analysis.correlations) {
    elements.push({
      tag: 'markdown',
      content: `**🔗 跨源关联**\n\n${analysis.correlations}`,
    })
  }

  // 行动项（如有）
  if (analysis.actionItems) {
    elements.push({
      tag: 'markdown',
      content: `**✅ 行动项**\n\n${analysis.actionItems}`,
    })
  }

  // 底部元信息
  const minutes = Math.round(totalDuration / 60_000)
  elements.push({
    tag: 'markdown',
    content: `<font color='grey'>${sourceCount} 源 · ${articleCount} 入选 · Sonnet+Opus · ${minutes}min</font>`,
  })

  return {
    schema: '2.0',
    config: { update_multi: true },
    header,
    body: { direction: 'vertical', elements },
  }
}

/**
 * 将每日简报写入 Obsidian Vault
 * 路径：{vaultPath}/digest/{date}.md
 * @param digest - 完整的每日简报数据
 * @param vaultPath - Obsidian Vault 根路径
 * @returns 写入的文件绝对路径
 */
export async function writeDigestToObsidian(
  digest: DailyDigest,
  vaultPath: string,
): Promise<string> {
  const { date, collections, scoredItems, analysis } = digest
  const sourceCount = collections.filter(c => !c.error || c.items.length > 0).length

  // 收集所有分类标签
  const categories = [...new Set(scoredItems.map(i => i.category))]
  const top5Urls = analysis.top5.map(t => t.item.url)

  // --- Frontmatter ---
  const frontmatter = [
    '---',
    'type: digest',
    `date: ${date}`,
    `sources: ${sourceCount}`,
    `articles: ${scoredItems.length}`,
    `top5:`,
    ...top5Urls.map(url => `  - "${url}"`),
    `tags:`,
    ...categories.map(cat => `  - ${cat}`),
    '---',
  ].join('\n')

  // --- Body ---
  const sections: string[] = []

  sections.push(`# 每日简报 — ${date}`)

  // 30 秒速读
  sections.push('## 30 秒速读')
  sections.push(analysis.quickRead || '暂无')

  // 今日必读
  sections.push('## 今日必读')
  for (const { item, reason } of analysis.top5) {
    sections.push(`### ${item.aiTitle}`)
    sections.push(item.aiSummary)
    if (reason !== item.aiSummary) {
      sections.push(`> 推荐理由：${reason}`)
    }
    sections.push(`[原文链接](${item.url})`)
    sections.push('')
  }

  // 跨源关联
  sections.push('## 跨源关联')
  sections.push(analysis.correlations || '暂无明显的跨源关联信号')

  // 行动项
  sections.push('## 行动项')
  sections.push(analysis.actionItems || '暂无具体行动建议')

  // 全部条目（markdown table，前 30 条）
  sections.push('## 全部条目')
  sections.push('')
  sections.push('| # | 标题 | 来源 | 分类 | 评分 |')
  sections.push('|---|------|------|------|------|')

  const tableItems = scoredItems.slice(0, 30)
  for (let i = 0; i < tableItems.length; i++) {
    const item = tableItems[i]
    // 转义 Markdown table 中的管道符
    const safeTitle = item.aiTitle.replace(/\|/g, '\\|')
    const safeSource = item.source.replace(/\|/g, '\\|')
    sections.push(
      `| ${i + 1} | [${safeTitle}](${item.url}) | ${safeSource} | ${item.category} | ${item.totalScore} |`,
    )
  }

  // 组合完整内容
  const content = frontmatter + '\n\n' + sections.join('\n\n')

  // 写入文件
  const filePath = `${vaultPath}/digest/${date}.md`
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')

  log.info({ filePath, size: content.length }, '简报已写入 Obsidian')
  return filePath
}

/**
 * 格式化 ScoredItem 为简短文本（用于日志/调试）
 * @param item - 评分后的条目
 */
export function formatScoredItem(item: ScoredItem): string {
  return `[${item.category}] ${item.aiTitle} (${item.totalScore}分) — ${item.source}`
}
