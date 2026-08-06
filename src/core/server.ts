import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { registry } from './registry.js';
import type { RouteDefinition, RouteInput } from './contract.js';
import { servedPath } from './contract.js';
import { store } from './store.js';
import { generateMock } from './mock.js';
import { resolveKey, satisfiesScopes, clientFingerprint } from './auth.js';
import { connectDatabases, type DatabaseConfig } from './database.js';

export interface ConstratoOptions {
  /** 业务服务集合，会注入到每个 handler 的 ctx.services */
  services?: Record<string, any>;
  logger?: boolean;
  /** 数据源配置（多类型数据库连接）。启动时自动连接，并注入 ctx.services.databases */
  databases?: DatabaseConfig[];
}

/** 把 zod 单部位 schema 转成 Fastify 可用的 JSON Schema（内联 $ref，避免解析问题）。 */
function toJsonSchema(schema?: z.ZodTypeAny): any {
  if (!schema) return undefined;
  try {
    return zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as any;
  } catch {
    return undefined;
  }
}

function buildSchema(def: RouteDefinition) {
  const input: RouteInput = def.meta.input ?? {};
  const schema: any = {};
  const qs = toJsonSchema(input.query);
  const params = toJsonSchema(input.params);
  const body = toJsonSchema(input.body);
  const headers = toJsonSchema(input.headers);
  if (qs) schema.querystring = qs;
  if (params) schema.params = params;
  if (body) schema.body = body;
  if (headers) schema.headers = headers;
  return schema;
}

/** 极简内存固定窗口限流（按 路由+客户端 维度计数）。 */
const rlWindows = new Map<string, { count: number; resetAt: number }>();

function hitRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = rlWindows.get(key);
  if (!w || now > w.resetAt) {
    rlWindows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  w.count += 1;
  return w.count > max;
}

export async function buildServer(opts: ConstratoOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] });

  // 启动时连接数据源（配置驱动，优雅降级：连接失败不会阻断服务启动）
  const dbBundle = await connectDatabases(opts.databases ?? []);
  (app as any).constrato = { databases: dbBundle.handles };
  const services: Record<string, any> = {
    ...(opts.services ?? {}),
    databases: dbBundle.handles,
  };
  for (const [name, handle] of Object.entries(dbBundle.handles)) {
    services[name] = handle;
  }

  app.addHook('onClose', async () => {
    for (const handle of Object.values(dbBundle.handles)) {
      try {
        await handle.close?.();
      } catch {}
    }
  });

  for (const def of registry.all()) {
    const url = servedPath(def.meta);
    const method = def.meta.method.toLowerCase() as any;

    app.route({
      method,
      url,
      schema: buildSchema(def),
      async preHandler(req, reply) {
        const cfg = await store.getRouteConfig(def.id);

        // 启用开关
        if (cfg.enabled === false) {
          return reply.code(503).send({ error: 'route_disabled', message: `接口 ${def.id} 已停用` });
        }

        // 鉴权（公开接口跳过）
        if (!def.meta.public) {
          const key = await resolveKey(req);
          const required = cfg.scopes ?? def.meta.scopes ?? [];
          if (!key) {
            reply.header('www-authenticate', 'ApiKey');
            return reply.code(401).send({ error: 'unauthorized', message: '缺少 API Key（请求头 x-api-key）' });
          }
          if (!satisfiesScopes(key, required)) {
            return reply
              .code(403)
              .send({ error: 'forbidden', message: `所需权限: ${required.join(', ') || '无'}，当前 Key 不具备` });
          }
        }

        // 限流
        const rl = cfg.rateLimit;
        if (rl && rl.max > 0) {
          const rlKey = `${def.id}:${clientFingerprint(req)}`;
          if (hitRateLimit(rlKey, rl.max, rl.windowMs)) {
            return reply
              .code(429)
              .send({ error: 'rate_limited', message: `超过限流 ${rl.max}/${rl.windowMs}ms` });
          }
        }
      },
      async handler(req, reply) {
        const cfg = await store.getRouteConfig(def.id);

        // Mock 模式：直接返回按 output schema 生成的假数据
        if (cfg.mock) {
          return reply.send(generateMock(def.meta.output));
        }

        const input: any = {};
        const inp = def.meta.input ?? {};
        if (inp.query) input.query = req.query;
        if (inp.params) input.params = req.params;
        if (inp.body) input.body = req.body;
        if (inp.headers) input.headers = req.headers;

        const ctx = { input, req, reply, app, services };
        const result = await def.handler(ctx);

        // 出参软校验：若契约声明了 output，则校验返回值是否符合
        if (def.meta.output && result !== undefined && result !== null) {
          const parsed = def.meta.output.safeParse(result);
          if (!parsed.success) {
            app.log?.warn?.(`[constrato] 接口 ${def.id} 返回值不符合 output 契约`);
          }
        }
        return reply.send(result);
      },
    });
  }

  // 根路径提示
  app.get('/', async () => {
    return {
      name: 'constrato',
      tagline: '前端定义契约 · 后端自动生成',
      routes: registry.ids().length,
      dashboard: '/dashboard',
      meta: '/__meta',
    };
  });

  return app;
}
