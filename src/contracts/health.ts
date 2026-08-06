import { z } from 'zod';
import { defineRoute } from '../core/contract.js';

/**
 * 健康检查 —— 公开接口，无需 API Key。
 * 这类「公开契约」在仪表盘里会标记为 public。
 */
export const health = defineRoute({
  name: 'health',
  method: 'GET',
  path: '/health',
  summary: '服务健康检查',
  tags: ['system'],
  public: true,
  output: z.object({
    status: z.enum(['ok', 'degraded']),
    uptime: z.number(),
    time: z.string(),
  }),
}).handler(async () => {
  return { status: 'ok', uptime: process.uptime(), time: new Date().toISOString() };
});
