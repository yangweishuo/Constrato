import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { clientFingerprint } from './auth.js';

/**
 * 安全防护配置。
 *
 * 设计原则：**默认安全 + 可按场景放宽**。
 * - 安全响应头：默认全开（headers 不显式关就开）。
 * - CORS：默认沿用历史行为（反射任意源，方便本地联调），但审计会标记为「风险」，建议改成 allowlist。
 * - 请求体大小 / 超时 / 全局限流：默认不强制，按需开启。
 */
export interface SecurityConfig {
  /** 安全响应头（HSTS / nosniff / X-Frame-Options / CSP 等）。默认开启。 */
  headers?: boolean;
  /** 自定义额外响应头（会覆盖内置同名项）。 */
  extraHeaders?: Record<string, string>;
  /** CORS 配置。不填 = 反射任意源（历史默认，审计标记警告）。 */
  cors?: {
    /** 允许的来源白名单；传 true = 反射任意源（危险）；传 false / 省略 origin = 关闭 CORS。 */
    origin?: string[] | boolean;
    methods?: string[];
    credentials?: boolean;
    /** 预检请求缓存秒数，默认 600。 */
    maxAge?: number;
  };
  /** 单请求最大 body 字节数（Fastify 构造期生效）。默认 1MB。 */
  bodyLimit?: number;
  /** 全局按 IP 的限流（保护 /、/dashboard、公开接口等所有路由）。 */
  globalRateLimit?: { max: number; windowMs: number };
  /** 单请求最大处理时长（毫秒）。超时直接断开连接，防 slowloris。 */
  requestTimeoutMs?: number;
  /** 是否位于反向代理之后。开启后 req.ip / 指纹才可信。 */
  trustProxy?: boolean | string | string[] | number;
  /** 是否暴露 x-powered-by / server 头。默认 false（不暴露，减少指纹泄露）。 */
  exposeServerHeader?: boolean;
}

const DEFAULT_BODY_LIMIT = 1_048_576; // 1MB

/* --------------------------- 安全响应头 --------------------------- */

function applySecurityHeaders(
  cfg: SecurityConfig,
  extra: Record<string, string>
) {
  const headers: Record<string, string> = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy':
      'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    ...extra,
  };

  return async function onSend(_req: FastifyRequest, reply: FastifyReply) {
    // API（非 HTML）用严格 CSP；HTML 仪表盘用可加载同源资源的 CSP
    const ct = String(reply.getHeader('content-type') || '');
    const csp = ct.startsWith('text/html')
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    reply.header('Content-Security-Policy', csp);

    for (const [k, v] of Object.entries(headers)) reply.header(k, v);

    if (!cfg.exposeServerHeader) {
      reply.removeHeader('server');
      reply.removeHeader('x-powered-by');
    }
  };
}

/* --------------------------- 全局限流 --------------------------- */

const globalWindows = new Map<string, { count: number; resetAt: number }>();

function hitGlobal(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = globalWindows.get(key);
  if (!w || now > w.resetAt) {
    globalWindows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  w.count += 1;
  return w.count > max;
}

/* --------------------------- 主入口 --------------------------- */

export async function applySecurity(app: FastifyInstance, cfg: SecurityConfig = {}) {
  // 1) 代理信任（影响 IP / 指纹真实性）
  if (cfg.trustProxy !== undefined) (app as any).setTrustProxy(cfg.trustProxy);

  // 2) CORS：可配置来源白名单，默认反射任意源（历史兼容）
  const c = cfg.cors;
  if (c && c.origin !== false && c.origin !== undefined) {
    await app.register(cors, {
      origin: c.origin,
      methods: c.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: c.credentials ?? false,
      maxAge: c.maxAge ?? 600,
    });
  } else if (!c) {
    // 历史默认：反射任意源，方便本地联调（但审计会警告）
    await app.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    });
  }

  // 3) 安全响应头（默认开启）
  if (cfg.headers !== false) {
    app.addHook('onSend', applySecurityHeaders(cfg, cfg.extraHeaders ?? {}));
  }

  // 4) 全局按 IP 限流
  if (cfg.globalRateLimit && cfg.globalRateLimit.max > 0) {
    const { max, windowMs } = cfg.globalRateLimit;
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const key = `global:${clientFingerprint(req)}`;
      if (hitGlobal(key, max, windowMs)) {
        reply.header('Retry-After', String(Math.ceil(windowMs / 1000)));
        return reply
          .code(429)
          .send({ error: 'rate_limited', message: `全局限流：超过 ${max}/${windowMs}ms` });
      }
    });
  }

  // 5) 请求超时（Node 层硬断开，防 slowloris / 慢连接耗尽）
  if (cfg.requestTimeoutMs && cfg.requestTimeoutMs > 0) {
    const srv = app.server as any;
    srv.requestTimeout = cfg.requestTimeoutMs;
    srv.headersTimeout = Math.max(cfg.requestTimeoutMs, 10_000);
  }
}

/** 取 Fastify 构造时用的 bodyLimit（server.ts 调用）。 */
export function resolveBodyLimit(cfg: SecurityConfig | undefined): number {
  return cfg?.bodyLimit ?? DEFAULT_BODY_LIMIT;
}

/* --------------------------- 安全态势自检 --------------------------- */

export interface SecurityPosture {
  headers: { enabled: boolean; list: Record<string, string> };
  cors: { mode: 'allowlist' | 'reflect-any' | 'disabled'; origins: string[]; credentials: boolean };
  bodyLimit: number;
  globalRateLimit: { enabled: boolean; max: number; windowMs: number };
  requestTimeoutMs: number | null;
  trustProxy: boolean;
  score: 'good' | 'weak';
  warnings: string[];
}

export function summarizeSecurity(cfg: SecurityConfig = {}): SecurityPosture {
  const headersOn = cfg.headers !== false;
  const extra = cfg.extraHeaders ?? {};
  const headerList: Record<string, string> = headersOn
    ? {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
        'Content-Security-Policy': '(按响应类型自动设置)',
        ...extra,
      }
    : {};

  let corsMode: SecurityPosture['cors']['mode'] = 'disabled';
  let corsOrigins: string[] = [];
  if (cfg.cors && cfg.cors.origin === false) corsMode = 'disabled';
  else if (cfg.cors && Array.isArray(cfg.cors.origin)) {
    corsMode = 'allowlist';
    corsOrigins = cfg.cors.origin;
  } else {
    corsMode = 'reflect-any'; // 历史默认
  }
  const corsCredentials = cfg.cors?.credentials ?? false;

  const warnings: string[] = [];
  if (corsMode === 'reflect-any') {
    warnings.push('CORS 当前为「反射任意源」，生产环境应改为来源白名单（security.cors.origin: [...]）。');
  }
  if (!cfg.globalRateLimit || cfg.globalRateLimit.max <= 0) {
    warnings.push('未开启全局限流，公开接口可能面临刷量 / DoS 风险（建议 security.globalRateLimit）。');
  }
  if (!cfg.requestTimeoutMs) {
    warnings.push('未设置请求超时，慢连接可能耗尽连接数（建议 security.requestTimeoutMs）。');
  }
  if (corsCredentials && corsMode === 'reflect-any') {
    warnings.push('CORS 同时开启了 credentials 与反射任意源，存在跨站凭证泄露风险，禁止此组合。');
  }

  const score: SecurityPosture['score'] =
    corsMode === 'reflect-any' || !cfg.globalRateLimit ? 'weak' : 'good';

  return {
    headers: { enabled: headersOn, list: headerList },
    cors: { mode: corsMode, origins: corsOrigins, credentials: corsCredentials },
    bodyLimit: resolveBodyLimit(cfg),
    globalRateLimit: {
      enabled: !!(cfg.globalRateLimit && cfg.globalRateLimit.max > 0),
      max: cfg.globalRateLimit?.max ?? 0,
      windowMs: cfg.globalRateLimit?.windowMs ?? 0,
    },
    requestTimeoutMs: cfg.requestTimeoutMs ?? null,
    trustProxy: cfg.trustProxy !== undefined && cfg.trustProxy !== false,
    score,
    warnings,
  };
}
