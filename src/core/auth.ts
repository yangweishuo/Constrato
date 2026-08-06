import type { FastifyRequest } from 'fastify';
import { store } from './store.js';

export const API_KEY_HEADER = 'x-api-key';
export const ADMIN_KEY_HEADER = 'x-admin-key';

/** 从请求里解析出 API Key 对象（无则返回 undefined）。 */
export async function resolveKey(req: FastifyRequest) {
  const token = req.headers[API_KEY_HEADER] as string | undefined;
  if (!token) return undefined;
  return store.findKey(token);
}

/** 判断某个 key 是否满足所需 scopes（空需求视为通过）。 */
export function satisfiesScopes(key: { scopes: string[] } | undefined, required: string[]): boolean {
  if (!required || required.length === 0) return true;
  if (!key) return false;
  return required.every((s) => key.scopes.includes(s));
}

/** 校验管理后台密钥（保护 /__meta 与所有写配置接口）。 */
export async function isAdmin(req: FastifyRequest): Promise<boolean> {
  const token = req.headers[ADMIN_KEY_HEADER] as string | undefined;
  if (!token) return false;
  return token === (await store.adminKey());
}

/** 生成本次请求的稳定指纹（用于限流计数，结合 IP）。 */
export function clientFingerprint(req: FastifyRequest): string {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown';
  return ip;
}
