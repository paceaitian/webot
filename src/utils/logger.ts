// Pino 日志封装
import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

/** 应用全局 logger */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
})

/** 创建子 logger，用于模块级日志 */
export function createLogger(module: string) {
  return logger.child({ module })
}
