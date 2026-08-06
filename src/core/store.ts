import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

/** 单条路由的运行时配置（可在仪表盘里改，无需重启）。 */
export interface RouteConfig {
  /** 是否启用 Mock（开启后直接返回按 output schema 生成的假数据，不执行 handler） */
  mock: boolean;
  /** 是否启用该路由 */
  enabled: boolean;
  /** 访问所需 scope（覆盖契约里写的 scopes） */
  scopes?: string[];
  /** 限流：时间窗内最大请求数 */
  rateLimit?: { max: number; windowMs: number };
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  scopes: string[];
  createdAt: string;
}

export interface StoreData {
  adminKey: string;
  routes: Record<string, RouteConfig>;
  keys: ApiKey[];
}

const DEFAULT: StoreData = { adminKey: '', routes: {}, keys: [] };

let cache: StoreData | null = null;

async function ensure(): Promise<StoreData> {
  if (cache) return cache;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    cache = { ...DEFAULT, ...JSON.parse(raw) } as StoreData;
  } catch {
    cache = { ...DEFAULT };
  }
  if (!cache!.adminKey) {
    cache!.adminKey = randomBytes(24).toString('hex');
    await persist();
  }
  return cache!;
}

async function persist(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

export const store = {
  async adminKey(): Promise<string> {
    return (await ensure()).adminKey;
  },

  async getRouteConfig(id: string): Promise<RouteConfig> {
    const data = await ensure();
    return data.routes[id] ?? { mock: false, enabled: true };
  },

  async setRouteConfig(id: string, patch: Partial<RouteConfig>): Promise<RouteConfig> {
    const data = await ensure();
    const base: RouteConfig = { mock: false, enabled: true };
    const next: RouteConfig = { ...base, ...data.routes[id], ...patch };
    data.routes[id] = next;
    await persist();
    return next;
  },

  async allRouteConfigs(): Promise<Record<string, RouteConfig>> {
    return (await ensure()).routes;
  },

  async listKeys(): Promise<ApiKey[]> {
    return (await ensure()).keys;
  },

  async createKey(name: string, scopes: string[]): Promise<ApiKey> {
    const data = await ensure();
    const key: ApiKey = {
      id: randomUUID(),
      name,
      key: `cdk_${randomBytes(16).toString('hex')}`,
      scopes,
      createdAt: new Date().toISOString(),
    };
    data.keys.push(key);
    await persist();
    return key;
  },

  async revokeKey(id: string): Promise<boolean> {
    const data = await ensure();
    const before = data.keys.length;
    data.keys = data.keys.filter((k) => k.id !== id);
    if (data.keys.length !== before) {
      await persist();
      return true;
    }
    return false;
  },

  async findKey(token: string): Promise<ApiKey | undefined> {
    const data = await ensure();
    return data.keys.find((k) => k.key === token);
  },
};
