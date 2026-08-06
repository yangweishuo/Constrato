import { z } from 'zod';
import { defineRoute } from '../core/contract.js';
import { summarizeDatabases, type DatabaseHandle } from '../core/database.js';

/**
 * 系统健康（含数据源状态）。
 * 演示契约如何访问注入的数据源：ctx.services.databases 是 name -> 句柄 的映射。
 *
 * 判定口径：只看「启用中」的数据源。配置里 enabled:false 的属于主动停用，
 * 状态记为 disabled，不会把整体健康拖成 false。
 */
export const systemHealth = defineRoute({
  name: 'systemHealth',
  method: 'GET',
  path: '/system/health',
  summary: '系统健康（含数据源状态）',
  tags: ['system'],
  public: true,
  output: z.object({
    ok: z.boolean(),
    summary: z.object({
      total: z.number(),
      healthy: z.number(),
      failed: z.number(),
      disabled: z.number(),
    }),
    databases: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        status: z.enum(['ok', 'down', 'disabled']),
        latencyMs: z.number().optional(),
        message: z.string().optional(),
      })
    ),
  }),
}).handler(async ({ services }) => {
  const dbs = ((services as any).databases || {}) as Record<string, DatabaseHandle>;
  const s = await summarizeDatabases(dbs);
  return {
    ok: s.ok,
    summary: { total: s.total, healthy: s.healthy, failed: s.failed, disabled: s.disabled },
    databases: s.list.map((d) => ({
      name: d.name,
      type: d.type,
      status: d.disabled ? ('disabled' as const) : d.ok ? ('ok' as const) : ('down' as const),
      latencyMs: d.latencyMs,
      message: d.message,
    })),
  };
});
