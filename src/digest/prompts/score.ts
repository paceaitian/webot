// Sonnet 批量评分 + 摘要 prompt — 用于每日简报条目的多维度评分和中文摘要生成

/** 评分系统提示 — 定义评分维度（相关性/质量/时效性）和输出格式 */
export const scoreSystemPrompt = `你是一位资深科技资讯编辑，负责对技术类信息源条目进行多维度评分和中文摘要。

## 评分维度（各 1-10 分）

- **相关性**（relevance）：与 AI、软件工程、开发工具、开源项目、技术创业的相关程度。核心技术话题高分，边缘关联低分。
- **质量**（quality）：内容深度、信息密度、原创性。深度分析/一手研究高分，标题党/水文低分。
- **时效性**（timeliness）：信息的新鲜度和时间敏感性。突发新闻/新发布高分，常青内容/旧闻低分。

## 输出要求

对每个条目：
1. 给出三个维度的评分（1-10 整数）
2. 生成简洁的中文标题（ai_title），保留关键术语英文
3. 撰写 2-3 句中文摘要（ai_summary），提炼核心信息
4. 归类到以下分类之一：AI / 安全 / 工程 / 工具 / 创业 / 热点 / 其他

## 评分原则

- 严格按条目序号（index）一一对应
- 评分要有区分度，避免全部给中间分
- 摘要聚焦"这条信息告诉我什么"，避免空泛描述`

/** 评分条目输入类型 */
interface ScoreItem {
  title: string
  url: string
  source: string
  description?: string
}

/**
 * 构建评分用户消息 — 将条目数组格式化为编号列表
 * @param items - 待评分的资讯条目
 * @returns 格式化的用户消息字符串
 */
export function scoreUserPrompt(items: ScoreItem[]): string {
  const formatted = items
    .map((item, i) => {
      const desc = item.description ? `\n   描述: ${item.description}` : ''
      return `${i + 1}. [${item.source}] ${item.title}\n   URL: ${item.url}${desc}`
    })
    .join('\n\n')

  return `请对以下 ${items.length} 条资讯进行评分和摘要：\n\n${formatted}`
}

/** 评分结构化输出 JSON Schema — 用于 Claude tool_choice 结构化输出 */
export const scoreSchema: Record<string, unknown> & { type: 'object' } = {
  type: 'object',
  properties: {
    scored_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: '条目序号（从 1 开始）' },
          relevance: { type: 'number', description: '相关性评分 1-10' },
          quality: { type: 'number', description: '质量评分 1-10' },
          timeliness: { type: 'number', description: '时效性评分 1-10' },
          ai_title: { type: 'string', description: '中文标题' },
          ai_summary: { type: 'string', description: '2-3 句中文摘要' },
          category: { type: 'string', enum: ['AI', '安全', '工程', '工具', '创业', '热点', '其他'] },
        },
        required: ['index', 'relevance', 'quality', 'timeliness', 'ai_title', 'ai_summary', 'category'],
      },
    },
  },
  required: ['scored_items'],
}
