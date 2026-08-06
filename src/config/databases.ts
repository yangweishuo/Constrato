import type { DatabaseConfig } from '../core/database.js';

/**
 * 数据源配置示例（多类型数据库连接）。
 *
 * 配置方式：在 buildServer({ databases: [...] }) 传入，或（本项目）由 src/index.ts 引入本文件。
 * 启动时框架会自动连接这里列出的每个数据源，并把句柄注入到每个契约的
 * `ctx.services.databases`（以及按 name 直接暴露，如 ctx.services.main）。
 *
 * - `memory`：零依赖、开箱即用，用于演示与本地开发。
 * - 其余类型：把 `enabled` 改为 true，并在项目里 `npm i <对应驱动>` 即可启用。
 *   未安装驱动 / 数据库没起来时，框架会优雅降级：该数据源标记为「不健康」，
 *   但服务照常启动，仪表盘「数据源」页会显示红色状态与错误信息。
 */
export const databases: DatabaseConfig[] = [
  { name: 'main', type: 'memory', enabled: true },

  // —— 关系型 ——
  // 需安装：npm i pg
  { name: 'pg', type: 'postgres', enabled: false, url: 'postgres://user:pass@localhost:5432/app' },
  // 需安装：npm i mysql2
  { name: 'mysql', type: 'mysql', enabled: false, host: 'localhost', port: 3306, user: 'root', password: '', database: 'app' },
  // MariaDB 复用 mysql2 驱动：npm i mysql2
  { name: 'mariadb', type: 'mariadb', enabled: false, host: 'localhost', port: 3306, user: 'root', password: '', database: 'app' },
  // 需安装：npm i better-sqlite3（含原生编译，首次安装较慢）
  { name: 'sqlite', type: 'sqlite', enabled: false, filename: './data/app.db' },
  // 需安装：npm i mssql
  { name: 'sqlserver', type: 'sqlserver', enabled: false, host: 'localhost', port: 1433, user: 'sa', password: '', database: 'app' },

  // —— 文档型 / NoSQL ——
  // 需安装：npm i mongodb
  { name: 'mongo', type: 'mongodb', enabled: false, url: 'mongodb://localhost:27017/app' },
  // 需安装：npm i redis
  { name: 'redis', type: 'redis', enabled: false, url: 'redis://localhost:6379' },

  // —— 分析型 ——
  // 需安装：npm i @clickhouse/client
  { name: 'clickhouse', type: 'clickhouse', enabled: false, url: 'http://localhost:8123', database: 'default' },

  // —— 自定义驱动 ——（用 connectFn 或 driver 扩展任意数据库，无需改框架）
  // {
  //   name: 'myDb',
  //   type: 'custom',
  //   connectFn: async (cfg) => {
  //     const client = await mySpecialDriver.connect(cfg.options);
  //     return client;
  //   },
  // },
];
