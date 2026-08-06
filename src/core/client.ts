import { registry } from './registry.js';
import { servedPath, type RouteMeta } from './contract.js';

export interface ClientOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  /** 可注入自定义 fetch（如 Node 环境、测试、带代理等） */
  fetchImpl?: typeof fetch;
}

function flattenQuery(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenQuery(v, prefix + k + '.'));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => (out[`${prefix}${k}[${i}]`] = String(item)));
    } else {
      out[prefix + k] = String(v);
    }
  }
  return out;
}

function buildUrl(base: string, meta: RouteMeta, input: any): string {
  let path = servedPath(meta);
  const params = input?.params ?? {};
  for (const [k, v] of Object.entries(params)) {
    path = path.replace(`:${k}`, encodeURIComponent(String(v)));
  }
  const query = input?.query ? flattenQuery(input.query) : {};
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  return `${base.replace(/\/$/, '')}${path}${qs}`;
}

/**
 * 生成一个「契约驱动」的前端客户端。
 *
 * 它不依赖任何手写映射 —— 直接读取 registry 中由契约自动注册的路由表，
 * 因此新增/修改任意契约，客户端立刻拥有对应方法且端到端类型一致。
 *
 * 典型用法（前端项目里）：
 * ```ts
 * import type * as api from 'constrato/contracts'; // 仅类型
 * const client = createClient('http://localhost:3000');
 * const user = await client.getUser({ params: { id: '1' } });
 * ```
 */
export function createClient(baseUrl: string, opts: ClientOptions = {}) {
  const doFetch = opts.fetchImpl ?? fetch;
  return new Proxy({} as Record<string, (input?: any) => Promise<any>>, {
    get(_t, prop: string) {
      const def = registry.get(prop);
      if (!def) return undefined;
      return async (input: any = {}) => {
        const url = buildUrl(baseUrl, def.meta, input);
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...(opts.headers ?? {}),
        };
        if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
        const method = def.meta.method;
        const body =
          method !== 'GET' && method !== 'DELETE'
            ? JSON.stringify(input?.body ?? {})
            : undefined;
        const res = await doFetch(url, { method, headers, body });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`[constrato] ${method} ${def.meta.path} -> ${res.status}: ${text}`);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : res.text();
      };
    },
  });
}

/** 列出当前客户端可用的全部方法名（调试/自省用）。 */
export function clientMethods(): string[] {
  return registry.ids();
}
