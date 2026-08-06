/**
 * Constrato 数据库连接层
 * ------------------------------------------------------------------
 * 设计目标：用「配置 + 适配器」的方式，让框架在启动时连接市面上各种类型的数据库，
 * 并把连接句柄注入到每个契约的 `ctx.services.databases`（以及按 name 直接暴露）。
 *
 * - 所有驱动都用动态 `import()` 按需加载：没装某个驱动时只会优雅报错（返回 broken 句柄），
 *   不会拖垮框架核心，也不会让 `tsc` 失败（见 src/types/external-modules.d.ts 的声明 shim）。
 * - 连接失败（数据库没起来、账号错等）不会让服务启动失败：对应数据源标记为 broken/不健康，
 *   仪表盘的「数据源」页会显示红色状态与错误信息。
 * - 想支持框架未内置的数据库？调用 `registerDatabaseAdapter('mydb', ...)` 即可扩展。
 */

/** 框架内置支持的数据源类型。 */
export type DatabaseType =
  | 'memory'
  | 'sqlite'
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'sqlserver'
  | 'mongodb'
  | 'redis'
  | 'clickhouse'
  | 'custom';

/** 单条数据库连接配置（在 buildServer({ databases: [...] }) 或配置文件中提供）。 */
export interface DatabaseConfig {
  /** 逻辑名，用于 ctx.services.databases[name] 以及仪表盘展示。 */
  name: string;
  /** 数据源类型，决定使用哪个适配器。 */
  type: DatabaseType;
  /** 是否启用，默认 true；设 false 会在仪表盘标记为「已停用」。 */
  enabled?: boolean;
  /** 连接串（postgres / mongodb / redis / clickhouse 推荐用这个）。 */
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** 本地文件（sqlite）。 */
  filename?: string;
  /** 连接池 / 驱动专属选项。 */
  pool?: Record<string, any>;
  /** 额外的驱动选项（如 sqlserver 的 options、clickhouse 的配置）。 */
  options?: Record<string, any>;
  /** type='custom'：直接导入的模块名（需导出 default/connect 工厂或用 connectFn）。 */
  driver?: string;
  /** type='custom'：内联的异步工厂函数。 */
  connectFn?: (cfg: DatabaseConfig) => Promise<any>;
}

/** 数据源健康状态（供仪表盘与 /__meta/databases 展示）。 */
export interface DatabaseStatus {
  name: string;
  type: DatabaseType;
  ok: boolean;
  latencyMs?: number;
  message?: string;
  /** 适配器初始化就失败了（没装驱动 / 配置不合法）。 */
  broken?: boolean;
  /** 配置里主动关掉的（enabled: false），不计入健康判定。 */
  disabled?: boolean;
}

/** 一条已建立（或失败）的数据源句柄，注入到 ctx.services。 */
export interface DatabaseHandle {
  name: string;
  type: DatabaseType;
  /** 原生客户端 / 连接池对象。 */
  client: any;
  /** 健康检查，返回 DatabaseStatus。 */
  health: () => Promise<DatabaseStatus>;
  close?: () => Promise<void> | void;
  /** 关系型数据库的通用查询（sqlite/postgres/mysql/sqlserver）。 */
  query?: (sql: string, params?: any[]) => Promise<any>;
  /** 非关系型的原生访问入口（mongodb/redis...）。 */
  raw?: (...args: any[]) => Promise<any>;
  /** 初始化是否失败。 */
  broken?: boolean;
  /** 是否为配置中主动停用的数据源（不算故障）。 */
  disabled?: boolean;
  /** 失败原因（若有）。 */
  error?: string;
}

/** 适配器：把配置变成一条句柄。 */
export type DatabaseAdapter = (cfg: DatabaseConfig) => Promise<DatabaseHandle>;

const adapters = new Map<DatabaseType, DatabaseAdapter>();

/** 注册（或覆盖）某类型的数据源适配器，用于扩展未内置的数据库。 */
export function registerDatabaseAdapter(type: DatabaseType, adapter: DatabaseAdapter): void {
  adapters.set(type, adapter);
}

/* ----------------------------------------------------------------- *
 * 内置适配器
 * ----------------------------------------------------------------- */

/** 进程内内存数据源：零依赖，开箱即用，适合演示与本地开发。 */
const memoryAdapter: DatabaseAdapter = async (cfg) => {
  const store = new Map<string, any>();
  return {
    name: cfg.name,
    type: 'memory',
    client: store,
    health: async () => ({
      name: cfg.name,
      type: 'memory',
      ok: true,
      message: `内存数据源（已存放 ${store.size} 条）`,
    }),
    close: () => {},
  };
};

const postgresAdapter: DatabaseAdapter = async (cfg) => {
  const pg = await import('pg').catch(() => {
    throw new Error('未安装 pg，请执行: npm i pg');
  });
  const pool = new pg.Pool(
    cfg.url
      ? { connectionString: cfg.url, ...cfg.pool }
      : {
          host: cfg.host,
          port: cfg.port ?? 5432,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ...cfg.pool,
        }
  );
  return {
    name: cfg.name,
    type: 'postgres',
    client: pool,
    query: (sql, params) => pool.query(sql, params),
    health: async () => {
      const t = Date.now();
      await pool.query('SELECT 1');
      return { name: cfg.name, type: 'postgres', ok: true, latencyMs: Date.now() - t };
    },
    close: () => pool.end().catch(() => {}),
  };
};

const mysqlAdapter: DatabaseAdapter = async (cfg) => {
  const mod = await import('mysql2/promise').catch(() => {
    throw new Error('未安装 mysql2，请执行: npm i mysql2');
  });
  const pool = mod.createPool({
    uri: cfg.url,
    host: cfg.host,
    port: cfg.port ?? 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    ...cfg.pool,
  });
  // 提前建一条连接，确保配置真实可用（失败会在 connectDatabase 里被捕获）
  const conn = await pool.getConnection();
  conn.release();
  return {
    name: cfg.name,
    type: cfg.type,
    client: pool,
    query: (sql, params) => pool.query(sql, params),
    health: async () => {
      const t = Date.now();
      await pool.query('SELECT 1');
      return { name: cfg.name, type: cfg.type, ok: true, latencyMs: Date.now() - t };
    },
    close: () => pool.end().catch(() => {}),
  };
};

const sqliteAdapter: DatabaseAdapter = async (cfg) => {
  const Database = (await import('better-sqlite3').catch(() => {
    throw new Error('未安装 better-sqlite3，请执行: npm i better-sqlite3');
  })) as any;
  const db = new Database(cfg.filename || ':memory:');
  return {
    name: cfg.name,
    type: 'sqlite',
    client: db,
    query: (sql, params) => db.prepare(sql).all(...(params ?? [])),
    health: async () => {
      const t = Date.now();
      db.prepare('SELECT 1').get();
      return { name: cfg.name, type: 'sqlite', ok: true, latencyMs: Date.now() - t };
    },
    close: () => db.close(),
  };
};

const sqlserverAdapter: DatabaseAdapter = async (cfg) => {
  const mssql = await import('mssql').catch(() => {
    throw new Error('未安装 mssql，请执行: npm i mssql');
  });
  const pool = new mssql.ConnectionPool(
    cfg.url
      ? { connectionString: cfg.url, ...cfg.options }
      : {
          server: cfg.host ?? 'localhost',
          port: cfg.port ?? 1433,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ...cfg.options,
        }
  );
  await pool.connect();
  return {
    name: cfg.name,
    type: 'sqlserver',
    client: pool,
    query: (sql, params) => pool.request().query(sql, params),
    health: async () => {
      const t = Date.now();
      await pool.request().query('SELECT 1');
      return { name: cfg.name, type: 'sqlserver', ok: true, latencyMs: Date.now() - t };
    },
    close: () => pool.close(),
  };
};

const mongoAdapter: DatabaseAdapter = async (cfg) => {
  const { MongoClient } = await import('mongodb').catch(() => {
    throw new Error('未安装 mongodb，请执行: npm i mongodb');
  });
  const client = new MongoClient(
    cfg.url || `mongodb://${cfg.user}:${cfg.password}@${cfg.host}:${cfg.port ?? 27017}/${cfg.database}`
  );
  await client.connect();
  return {
    name: cfg.name,
    type: 'mongodb',
    client,
    raw: (db: string, col: string, fn: (c: any) => any) => fn(client.db(db).collection(col)),
    health: async () => {
      const t = Date.now();
      await client.db(cfg.database || 'admin').admin().ping();
      return { name: cfg.name, type: 'mongodb', ok: true, latencyMs: Date.now() - t };
    },
    close: () => client.close(),
  };
};

const redisAdapter: DatabaseAdapter = async (cfg) => {
  const { createClient } = await import('redis').catch(() => {
    throw new Error('未安装 redis，请执行: npm i redis');
  });
  const client = createClient({
    url: cfg.url || `redis://${cfg.host ?? 'localhost'}:${cfg.port ?? 6379}`,
  });
  client.on('error', () => {});
  await client.connect();
  return {
    name: cfg.name,
    type: 'redis',
    client,
    raw: (...args: any[]) => client.sendCommand(args),
    health: async () => {
      const t = Date.now();
      await client.ping();
      return { name: cfg.name, type: 'redis', ok: true, latencyMs: Date.now() - t };
    },
    close: () => client.quit().catch(() => {}),
  };
};

const clickhouseAdapter: DatabaseAdapter = async (cfg) => {
  const { createClient } = await import('@clickhouse/client').catch(() => {
    throw new Error('未安装 @clickhouse/client，请执行: npm i @clickhouse/client');
  });
  const client = createClient({
    url: cfg.url,
    username: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ...cfg.options,
  });
  return {
    name: cfg.name,
    type: 'clickhouse',
    client,
    query: (sql, params) =>
      client.query({ query: sql, query_params: params as any }).then((r: any) => r.json()),
    health: async () => {
      const t = Date.now();
      await client.ping();
      return { name: cfg.name, type: 'clickhouse', ok: true, latencyMs: Date.now() - t };
    },
    close: () => client.close(),
  };
};

const customAdapter: DatabaseAdapter = async (cfg) => {
  if (cfg.connectFn) {
    const client = await cfg.connectFn(cfg);
    return {
      name: cfg.name,
      type: 'custom',
      client,
      health: async () => ({ name: cfg.name, type: 'custom', ok: true }),
      close: () => {},
    };
  }
  if (cfg.driver) {
    const mod: any = await import(cfg.driver as string);
    const factory = mod.default ?? mod.connect ?? mod;
    const client = await factory(cfg);
    return {
      name: cfg.name,
      type: 'custom',
      client,
      health: async () => ({ name: cfg.name, type: 'custom', ok: true }),
      close: () => {},
    };
  }
  throw new Error("type='custom' 需要 connectFn 或 driver");
};

/* ----------------------------------------------------------------- *
 * 注册内置适配器
 * ----------------------------------------------------------------- */
registerDatabaseAdapter('memory', memoryAdapter);
registerDatabaseAdapter('postgres', postgresAdapter);
registerDatabaseAdapter('mysql', mysqlAdapter);
registerDatabaseAdapter('mariadb', mysqlAdapter);
registerDatabaseAdapter('sqlite', sqliteAdapter);
registerDatabaseAdapter('sqlserver', sqlserverAdapter);
registerDatabaseAdapter('mongodb', mongoAdapter);
registerDatabaseAdapter('redis', redisAdapter);
registerDatabaseAdapter('clickhouse', clickhouseAdapter);
registerDatabaseAdapter('custom', customAdapter);

/* ----------------------------------------------------------------- *
 * 连接编排
 * ----------------------------------------------------------------- */

function brokenHandle(name: string, type: DatabaseType, err: unknown): DatabaseHandle {
  const raw = err instanceof Error ? err.message || String(err) : String(err);
  const message = raw || `数据源 ${name} 初始化失败`;
  return {
    name,
    type,
    client: null,
    broken: true,
    error: message,
    health: async () => ({ name, type, ok: false, broken: true, message }),
    close: () => {},
  };
}

/**
 * 主动停用的数据源。它不是故障：不计入健康判定，只是在仪表盘里灰着。
 * 访问它的 query/raw 会明确报错，避免静默返回 undefined。
 */
function disabledHandle(name: string, type: DatabaseType): DatabaseHandle {
  const message = '已在配置中停用 (enabled: false)';
  const reject = async (): Promise<never> => {
    throw new Error(`数据源 ${name} 已停用，无法使用。请在配置中设置 enabled: true`);
  };
  return {
    name,
    type,
    client: null,
    disabled: true,
    error: message,
    health: async () => ({ name, type, ok: false, disabled: true, message }),
    query: reject,
    raw: reject,
    close: () => {},
  };
}

/** 连接单条数据源。任何失败都会返回 broken 句柄，绝不会抛错。 */
export async function connectDatabase(cfg: DatabaseConfig): Promise<DatabaseHandle> {
  if (cfg.enabled === false) {
    return disabledHandle(cfg.name, cfg.type);
  }
  const adapter = adapters.get(cfg.type);
  if (!adapter) {
    return brokenHandle(cfg.name, cfg.type, new Error(`不支持的数据源类型: ${cfg.type}`));
  }
  try {
    return await adapter(cfg);
  } catch (e) {
    return brokenHandle(cfg.name, cfg.type, e);
  }
}

export interface DatabasesBundle {
  /** name -> 句柄 */
  handles: Record<string, DatabaseHandle>;
  list: DatabaseHandle[];
}

/** 批量连接一组数据源（用于启动时）。 */
export async function connectDatabases(configs: DatabaseConfig[] = []): Promise<DatabasesBundle> {
  const handles: Record<string, DatabaseHandle> = {};
  for (const cfg of configs) {
    const h = await connectDatabase(cfg);
    handles[h.name] = h;
  }
  return { handles, list: Object.values(handles) };
}

/** 取一条句柄的健康状态（内部已兜底）。 */
export async function healthOf(h: DatabaseHandle): Promise<DatabaseStatus> {
  try {
    const s = await h.health();
    // 句柄自身的标记优先，防止适配器忘了带上。
    return { ...s, broken: s.broken ?? h.broken, disabled: s.disabled ?? h.disabled };
  } catch (e: any) {
    return {
      name: h.name,
      type: h.type,
      ok: false,
      broken: true,
      disabled: h.disabled,
      message: String(e?.message ?? e),
    };
  }
}

/** 数据源整体概览。停用的数据源不参与 ok 判定。 */
export interface DatabasesSummary {
  /** 所有启用中的数据源都健康（没有启用项时也算健康）。 */
  ok: boolean;
  list: DatabaseStatus[];
  total: number;
  healthy: number;
  /** 启用了但连不上的。 */
  failed: number;
  /** 配置中主动停用的。 */
  disabled: number;
}

/** 并发采集全部数据源状态，并给出整体结论。 */
export async function summarizeDatabases(
  input: Record<string, DatabaseHandle> | DatabaseHandle[]
): Promise<DatabasesSummary> {
  const handles = Array.isArray(input) ? input : Object.values(input);
  const list = await Promise.all(handles.map((h) => healthOf(h)));
  const active = list.filter((s) => !s.disabled);
  return {
    ok: active.every((s) => s.ok),
    list,
    total: list.length,
    healthy: list.filter((s) => s.ok).length,
    failed: active.filter((s) => !s.ok).length,
    disabled: list.length - active.length,
  };
}
