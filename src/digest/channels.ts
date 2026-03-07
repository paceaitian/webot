// 渠道注册表 — 定义所有渠道配置和分组

import type { ChannelConfig, ChannelGroupConfig } from './collectors/types.js'

/** 全部渠道配置 */
export const CHANNELS: ChannelConfig[] = [
  // 技术精选 — Sonnet 评分 + AI 摘要
  { id: 'hackernews',     name: 'Hacker News',    group: 'tech', displayCount: 10, scored: true },
  { id: 'producthunt',    name: 'Product Hunt',   group: 'tech', displayCount: 10, scored: true },
  { id: 'github-trending', name: 'GitHub Trending', group: 'tech', displayCount: 10, scored: true },
  { id: 'v2ex',           name: 'V2EX',           group: 'tech', displayCount: 10, scored: true },
  { id: 'rss',            name: 'RSS 精选',        group: 'tech', displayCount: 10, scored: true },

  // 国内热点 — 不评分，保留平台排名
  { id: 'weibo',          name: '微博热搜',        group: 'domestic-hot', displayCount: 5, scored: false },
  { id: 'zhihu',          name: '知乎热榜',        group: 'domestic-hot', displayCount: 5, scored: false },
  { id: 'douyin',         name: '抖音热榜',        group: 'domestic-hot', displayCount: 3, scored: false },
  { id: 'xiaohongshu',    name: '小红书',          group: 'domestic-hot', displayCount: 3, scored: false },
  { id: 'hupu',           name: '虎扑',            group: 'domestic-hot', displayCount: 3, scored: false },
  { id: 'tieba',          name: '百度贴吧',        group: 'domestic-hot', displayCount: 3, scored: false },
  { id: 'toutiao',        name: '今日头条',        group: 'domestic-hot', displayCount: 3, scored: false },
  { id: '60s-news',       name: '60秒读世界',      group: 'domestic-hot', displayCount: 3, scored: false },

  // 国内科技 — 不评分
  { id: '36kr',           name: '36氪',            group: 'domestic-tech', displayCount: 3, scored: false },
  { id: 'ithome',         name: 'IT之家',          group: 'domestic-tech', displayCount: 3, scored: false },
  { id: 'coolapk',        name: '酷安',            group: 'domestic-tech', displayCount: 3, scored: false },
  { id: 'thepaper',       name: '澎湃新闻',       group: 'domestic-tech', displayCount: 3, scored: false },

  // 财经快讯 — 不评分
  { id: 'wallstreetcn',   name: '华尔街见闻',     group: 'finance', displayCount: 3, scored: false },
  { id: 'cls-telegraph',  name: '财联社',          group: 'finance', displayCount: 3, scored: false },
  { id: 'mktnews',        name: 'MKTNews',         group: 'finance', displayCount: 3, scored: false },
]

/** 分组显示配置 */
export const CHANNEL_GROUPS: ChannelGroupConfig[] = [
  { id: 'tech',          label: '技术精选', channels: CHANNELS.filter(c => c.group === 'tech') },
  { id: 'domestic-hot',  label: '国内热点', channels: CHANNELS.filter(c => c.group === 'domestic-hot') },
  { id: 'domestic-tech', label: '国内科技', channels: CHANNELS.filter(c => c.group === 'domestic-tech') },
  { id: 'finance',       label: '财经快讯', channels: CHANNELS.filter(c => c.group === 'finance') },
]

/**
 * 根据渠道 ID 查找配置
 */
export function getChannelById(id: string): ChannelConfig | undefined {
  return CHANNELS.find(c => c.id === id)
}

/**
 * 获取需要评分的渠道 ID 列表
 */
export function getScoredChannelIds(): string[] {
  return CHANNELS.filter(c => c.scored).map(c => c.id)
}
