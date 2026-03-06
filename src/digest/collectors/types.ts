// 每日简报采集类型定义

/** 单条采集结果 */
export interface DigestItem {
  /** 标题 */
  title: string
  /** 链接 */
  url: string
  /** 来源标识（如 'github-trending'、'hackernews'） */
  source: string
  /** 摘要/描述（可选，RSS 自带） */
  description?: string
  /** 发布时间（可选） */
  publishedAt?: string
  /** 额外元数据 */
  extra?: Record<string, string>
}

/** Collector 采集结果 */
export interface CollectorResult {
  /** collector 名称 */
  name: string
  /** 采集到的条目 */
  items: DigestItem[]
  /** 采集耗时 ms */
  duration: number
  /** 错误信息（部分失败时） */
  error?: string
}

/** Sonnet 评分后的条目 */
export interface ScoredItem extends DigestItem {
  /** 相关性评分 1-10 */
  relevance: number
  /** 质量评分 1-10 */
  quality: number
  /** 时效性评分 1-10 */
  timeliness: number
  /** 总分（三维相加） */
  totalScore: number
  /** AI 生成的中文标题 */
  aiTitle: string
  /** AI 生成的中文摘要（2-3 句） */
  aiSummary: string
  /** 分类 */
  category: 'AI' | '安全' | '工程' | '工具' | '创业' | '热点' | '其他'
}

/** Opus 综合分析结果 */
export interface DigestAnalysis {
  /** 30 秒速读（3-5 句宏观趋势） */
  quickRead: string
  /** 今日必读 Top 5 */
  top5: Array<{
    item: ScoredItem
    reason: string
  }>
  /** 跨源关联发现 */
  correlations: string
  /** 行动项建议 */
  actionItems: string
}

/** 完整的每日简报 */
export interface DailyDigest {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 所有采集结果 */
  collections: CollectorResult[]
  /** 评分后的条目（按总分降序） */
  scoredItems: ScoredItem[]
  /** Opus 综合分析 */
  analysis: DigestAnalysis
  /** 总耗时 ms */
  totalDuration: number
}
