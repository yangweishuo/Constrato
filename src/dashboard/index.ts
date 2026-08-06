import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { registry } from '../core/registry.js';
import { servedPath, type RouteDefinition } from '../core/contract.js';
import { store } from '../core/store.js';
import { isAdmin } from '../core/auth.js';
import { summarizeDatabases, type DatabaseHandle } from '../core/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function toSchema(schema?: z.ZodTypeAny): any {
  if (!schema) return null;
  try {
    return zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as any;
  } catch {
    return null;
  }
}

/** 把一条路由转换成仪表盘需要的元数据（含 JSON Schema，供前端自动生成表单）。 */
async function metaOf(def: RouteDefinition) {
  const input = def.meta.input ?? {};
  const inputParts: { part: string; schema: any }[] = [];
  for (const part of ['query', 'params', 'body', 'headers'] as const) {
    const s = toSchema((input as any)[part]);
    if (s) inputParts.push({ part, schema: s });
  }
  const cfg = await store.getRouteConfig(def.id);
  return {
    id: def.id,
    method: def.meta.method,
    path: def.meta.path,
    servedPath: servedPath(def.meta),
    version: def.meta.version ?? 1,
    summary: def.meta.summary ?? def.id,
    description: def.meta.description ?? '',
    tags: def.meta.tags ?? ['default'],
    public: !!def.meta.public,
    scopes: def.meta.scopes ?? [],
    inputParts,
    outputSchema: toSchema(def.meta.output),
    config: {
      mock: cfg.mock,
      enabled: cfg.enabled,
      scopes: cfg.scopes,
      rateLimit: cfg.rateLimit,
    },
  };
}

export async function mountDashboard(app: FastifyInstance): Promise<void> {
  // 所有 /__meta 写操作都要求管理密钥
  const guard = async (req: any, reply: any) => {
    if (!(await isAdmin(req))) {
      return reply.code(401).send({ error: 'unauthorized', message: '需要 x-admin-key（见服务启动日志）' });
    }
  };

  /* ----------------------------- 元数据读取 ----------------------------- */
  app.get('/__meta', { preHandler: guard }, async () => {
    const routes = await Promise.all(registry.all().map(metaOf));
    const keys = await store.listKeys();
    const scopes = Array.from(
      new Set(routes.flatMap((r) => [...r.scopes, ...(r.config.scopes ?? [])]))
    ).sort();
    const versions = Array.from(new Set(routes.map((r) => r.version))).sort();
    const dbHandles = (app as any).constrato?.databases || {};
    const datasources = Object.keys(dbHandles).length;
    const secPosture = (app as any).constrato?.security || null;
    return {
      name: 'constrato',
      tagline: '前端定义契约 · 后端自动生成',
      routes,
      keys,
      scopes,
      versions,
      security: secPosture,
      counts: {
        routes: routes.length,
        publicRoutes: routes.filter((r) => r.public).length,
        mocked: routes.filter((r) => r.config.mock).length,
        datasources,
        security: secPosture?.score === 'good' ? 1 : 0,
      },
    };
  });

  /* ----------------------------- 安全态势自检 ----------------------------- */
  app.get('/__meta/security', { preHandler: guard }, async () => {
    const posture = (app as any).constrato?.security;
    if (!posture) return { error: 'security_not_configured' };
    return posture;
  });

  app.get('/__meta/routes/:id', { preHandler: guard }, async (req: any, reply: any) => {
    const def = registry.get((req.params as any).id);
    if (!def) return reply.code(404).send({ error: 'not_found' });
    return metaOf(def);
  });

  /* ----------------------------- 路由配置（运行时改，无需重启） ----------------------------- */
  app.put('/__meta/routes/:id', { preHandler: guard }, async (req: any, reply: any) => {
    const id = (req.params as any).id;
    if (!registry.get(id)) return reply.code(404).send({ error: 'not_found' });
    const body = req.body as any;
    const next = await store.setRouteConfig(id, {
      mock: body.mock,
      enabled: body.enabled,
      scopes: body.scopes,
      rateLimit: body.rateLimit,
    });
    return { id, config: next };
  });

  /* ----------------------------- API Key 管理 ----------------------------- */
  app.get('/__meta/keys', { preHandler: guard }, async () => store.listKeys());

  app.post('/__meta/keys', { preHandler: guard }, async (req: any, reply: any) => {
    const body = req.body as any;
    if (!body?.name) return reply.code(400).send({ error: 'name 必填' });
    const key = await store.createKey(String(body.name), Array.isArray(body.scopes) ? body.scopes : []);
    return key;
  });

  app.delete('/__meta/keys/:id', { preHandler: guard }, async (req: any, reply: any) => {
    const ok = await store.revokeKey((req.params as any).id);
    return { ok };
  });

  /* ----------------------------- 数据源（数据库连接）状态 ----------------------------- */
  app.get('/__meta/databases', { preHandler: guard }, async () => {
    const dbs = ((app as any).constrato?.databases || {}) as Record<string, DatabaseHandle>;
    const s = await summarizeDatabases(dbs);
    return {
      ok: s.ok,
      databases: s.list.map((d) => ({
        name: d.name,
        type: d.type,
        status: d.disabled ? 'disabled' : d.ok ? 'ok' : 'down',
        ok: d.ok,
        latencyMs: d.latencyMs,
        message: d.message,
        broken: !!d.broken,
        disabled: !!d.disabled,
      })),
      count: s.total,
      healthy: s.healthy,
      failed: s.failed,
      disabled: s.disabled,
    };
  });

  /* ----------------------------- 静态仪表盘 ----------------------------- */
  app.get('/dashboard', async (_req, reply) => {
    const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    reply.type('text/html').send(html);
  });

  app.get('/dashboard/*', async (req: any, reply: any) => {
    const p = (req.params as any)['*'] || '';
    // 路径穿越加固：解析后必须仍处在 PUBLIC_DIR 内，否则 403
    const file = path.resolve(PUBLIC_DIR, p);
    const root = path.resolve(PUBLIC_DIR);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return reply.code(403).send('forbidden');
    }
    try {
      const buf = await fs.readFile(file);
      const ext = path.extname(file);
      reply.type(MIME[ext] ?? 'application/octet-stream').send(buf);
    } catch {
      reply.code(404).send('not found');
    }
  });
}
