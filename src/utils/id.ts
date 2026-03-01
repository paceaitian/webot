// nanoid 封装，统一 ID 生成
import { nanoid } from 'nanoid'

/** 生成唯一 ID（默认 21 字符） */
export function generateId(size?: number): string {
  return nanoid(size)
}

/** 生成短 ID（8 字符，用于文件名后缀等） */
export function shortId(): string {
  return nanoid(8)
}
