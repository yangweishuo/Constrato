> 其他语言：[English](./README.en.md)

# ⚡ Constrato

> 用**前端契约**驱动后端 —— 仪表盘 + 接口管理一体化的全栈开发新模式。

Constrato 是一个用 TypeScript 编写、基于 [Fastify](https://fastify.dev) + [Zod](https://zod.dev) 的开源后端框架。
核心理念：**你只写一份接口契约（`defineRoute`），后端自动生成路由、入参校验、文档与仪表盘**，前端通过同一份契约获得端到端类型安全。

```
┌─────────────┐     同一份 TS 契约     ┌──────────────────┐
│  前端项目   │ ──── contract.ts ───▶ │  Constrato 后端    │
│  createClient│ ◀── 端到端类型 ────  │  自动注册路由    │
└─────────────┘                      │  仪表盘/接口管理  │
                                    └──────────────────┘
```

## ✨ 特性

- **契约优先**：一个 `defineRoute` 同时描述 方法 / 路径 / 入参 / 出参 / 权限，前后端共享同一份 Zod schema。
- **自动生成**：启动时契约自动注册成真实路由（含校验、鉴权、限流、Mock），无需手写路由绑定。
- **内置仪表盘**（`/dashboard`）：
  - 📖 自动接口文档（由 schema 生成）
  - 🧪 在线调试（表单化请求 + 实时响应）
  - 🎭 Mock 模式（按 output schema 生成假数据，跳过真实逻辑）
  - 🔖 版本管理（契约里写 `version` 自动加 `/v{n}` 前缀）
  - 🔐 权限管理（按 scope 鉴权 + API Key 签发/吊销）
  - ⏱ 限流配置（按接口生效，运行时可改，无需重启）
  - 🗄 数据源状态（多类型数据库连接健康，三态展示）
  - 🔒 安全态势（响应头 / CORS / 限流 / 超时 评分与加固建议）

## 🚀 快速开始

```bash
npm install
npm run dev          # 开发模式（tsx watch）
# 或
npm start            # 生产模式（tsx）
```

启动后访问：

- 仪表盘： http://localhost:3000/dashboard
- 元数据： http://localhost:3000/__meta
- 健康检查： http://localhost:3000/health

> 进入仪表盘需要 `x-admin-key`，它会在**终端启动日志**里打印，粘贴进控制台即可（仅存于浏览器 localStorage）。

## ✍️ 怎么写一个接口

在 `src/contracts/` 下新建一个文件，用 `defineRoute` 描述契约并附上 handler：

```ts
import { z } from 'zod';
import { defineRoute } from '../core/contract.js';

export const getUser = defineRoute({
  name: 'getUser',
  method: 'GET',
  path: '/users/:id',
  summary: '获取单个用户',
  tags: ['users'],
  scopes: ['user:read'],
  input: { params: z.object({ id: z.string() }) },
  output: z.object({ id: z.string(), name: z.string() }),
}).handler(async ({ input, services }) => {
  return services.users.findById(input.params.id);
});
```

然后在 `src/contracts/index.ts` 里 `import './yourfile.js';` —— 路由、校验、文档、调试面板**全部自动就绪**。

## 🧩 前端怎么用

前端通过同一份契约获得类型安全的客户端：

```ts
import { createClient } from 'constrato/core/client.js';

const client = createClient('http://localhost:3000', { apiKey: 'cdk_xxx' });
const user = await client.getUser({ params: { id: '1' } }); // 全类型推断
```

`createClient` 直接读取契约注册表，因此**新增/修改任意契约，客户端立刻拥有对应方法**。

## 🗄 数据库连接（多类型）

Constrato 把数据库连接也做成了「配置驱动 + 适配器」：启动时按配置连好各种数据库，把句柄注入到每个契约的 `ctx.services.databases`（也按 name 直接暴露，如 `ctx.services.main`），并在仪表盘「数据源」页实时展示连接健康状态。

支持的类型（驱动按需 `import()`，没装对应驱动时只会在该数据源上优雅报错，不拖垮核心）：

| 类型 | 驱动包 | 说明 |
|---|---|---|
| `memory` | 内置 | 进程内内存，**零依赖**，开箱即用 |
| `postgres` | `pg` | PostgreSQL |
| `mysql` / `mariadb` | `mysql2` | MySQL / MariaDB |
| `sqlite` | `better-sqlite3` | 本地文件或内存库 |
| `sqlserver` | `mssql` | SQL Server |
| `mongodb` | `mongodb` | 文档数据库 |
| `redis` | `redis` | 键值 / 缓存 |
| `clickhouse` | `@clickhouse/client` | 分析型列式库 |
| `custom` | 自写 | 用 `connectFn` 或 `driver` 扩展任意数据库 |

配置方式（`src/config/databases.ts`，由 `src/index.ts` 引入）：

```ts
import type { DatabaseConfig } from '../core/database.js';

export const databases: DatabaseConfig[] = [
  { name: 'main', type: 'memory', enabled: true },                 // 零依赖，开箱即用
  { name: 'pg',   type: 'postgres',  enabled: false, url: 'postgres://user:pass@localhost:5432/app' },
  { name: 'mysql',type: 'mysql',     enabled: false, host: 'localhost', port: 3306, user: 'root', password: '', database: 'app' },
  { name: 'mongo',type: 'mongodb',   enabled: false, url: 'mongodb://localhost:27017/app' },
  { name: 'redis',type: 'redis',     enabled: false, url: 'redis://localhost:6379' },
];
```

启用某个类型前先装驱动：`npm i pg`（其余同理，见上表）。把对应项的 `enabled` 改为 `true` 即可。

**在契约里用数据源**：

```ts
export const listUsers = defineRoute({
  name: 'listUsers', method: 'GET', path: '/users',
  // ...
}).handler(async ({ services }) => {
  const db = services.main;            // 即配置里 name:'main' 的句柄
  const rows = await db.query('SELECT * FROM users'); // postgres/mysql/sqlite/sqlserver 通用
  return rows;
});
```

MongoDB / Redis 等用 `handle.raw(...)` 访问原生客户端。

**连接失败不会让服务启动失败。** 每个数据源独立降级，只有三种状态：

| 状态 | 含义 | 是否计入整体健康 |
|---|---|---|
| `ok` | 连接正常 | ✅ 计入 |
| `down` | 启用了但连不上（驱动缺失 / 网络不通 / 类型不支持） | ✅ 计入，会让整体健康变红 |
| `disabled` | 配置里 `enabled: false`，主动关掉的 | ❌ 不计入 |

这样把没启用的数据源留在配置里做「模板」不会污染健康检查。停用的句柄仍然存在，但调用它的 `query()` / `raw()` 会明确抛错，不会静默返回空值。

查看状态：

- `GET /system/health` —— 公开，返回 `ok` + 每个数据源的 `status`
- `GET /__meta/databases` —— 需管理密钥，附带延迟、失败原因与分类计数
- 仪表盘「🗄️ 数据源」页 —— 健康 / 连接失败 / 已停用 三色展示

## 🔒 安全防护

Constrato 把常见的安全防护做成了**配置驱动、默认安全**的一层。所有能力集中在 `src/core/security.ts`，由 `src/config/security.ts` 配置，传入 `buildServer({ security })`。

默认（开发期友好，仍能跑通联调）：

- ✅ 安全响应头全开（HSTS / `X-Content-Type-Options: nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy` / 按响应类型自动设置的 `Content-Security-Policy`），并移除 `server` / `x-powered-by` 指纹头
- ⚠️ CORS 反射任意源（本地联调方便，生产必须改白名单）
- ⚠️ 全局限流 / 请求超时默认关闭（按需开启）

配置示例（`src/config/security.ts`）：

```ts
import type { SecurityConfig } from '../core/security.js';

export const security: SecurityConfig = {
  headers: true,                         // 安全响应头（默认开）
  cors: {
    origin: ['https://app.example.com'],// 生产改成白名单；开发期可设 true（反射任意源）
    credentials: false,
    maxAge: 600,
  },
  // bodyLimit: 1_048_576,               // 单请求 body 上限（默认 1MB）
  // globalRateLimit: { max: 600, windowMs: 60_000 }, // 按 IP 全局限流，防刷量/DoS
  // requestTimeoutMs: 15_000,           // 请求超时，防 slowloris
  // trustProxy: true,                   // 部署在 Nginx / 网关后开启，让 IP 可信
};
```

能力清单：

| 能力 | 配置项 | 默认 | 说明 |
|---|---|---|---|
| 安全响应头 | `headers` | 开 | HSTS / nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP |
| 指纹隐藏 | `exposeServerHeader` | 关 | 移掉 `server` / `x-powered-by` |
| CORS | `cors.origin` | 反射任意源 | 生产改用来源数组白名单 |
| 请求体上限 | `bodyLimit` | 1MB | 防超大 payload |
| 全局限流 | `globalRateLimit` | 关闭 | 按 IP 的「时间窗计数器」，保护 /、/dashboard、公开接口等所有路由 |
| 请求超时 | `requestTimeoutMs` | 关闭 | Node 层硬断开慢连接，防 slowloris |
| 代理信任 | `trustProxy` | 关闭 | 反向代理后开启，使 `req.ip` / 限流指纹可信 |

> 契约级的「API Key + scope 鉴权」和「单路由限流」仍由 `src/core/auth.ts` + 路由 `preHandler` 提供（见各 `defineRoute` 的 `scopes` 与 `/__meta` 里的 `rateLimit`），与本层互补。

查看安全态势：

- `GET /__meta/security` —— 需管理密钥，返回当前防护配置与加固建议
- 仪表盘「🔒 安全态势」页 —— 防护评分（达标 / 待加固）、各能力开关、生效响应头清单、风险提示
- 另外，「静态资源」接口做了路径穿越加固：解析后的真实路径必须仍处于 `public/` 目录内，否则 403

## 🗂 项目结构

```
src/
  core/            # 框架内核（契约、注册中心、服务、Mock、鉴权、客户端、数据库、安全）
    contract.ts    # defineRoute / RouteMeta —— 全栈唯一事实来源
    registry.ts    # 全局路由注册中心
    server.ts      # 由契约自动构建 Fastify 服务
    store.ts       # 运行时配置持久化（mock/限流/权限/密钥）
    mock.ts        # 由 zod schema 生成 mock 数据
    auth.ts        # API Key + scope 鉴权
    client.ts      # 类型化前端客户端
    database.ts    # 多类型数据库连接层（适配器 + 配置驱动）
    security.ts    # 安全防护层（响应头 / CORS / 限流 / 超时）
  config/          # 运行配置（databases.ts / security.ts）
  contracts/       # 你的接口契约（前端也在用这一份）
  dashboard/       # 仪表盘（/__meta 接口 + 前端静态资源）
  index.ts         # 启动入口
data/              # 运行时持久化数据（gitignore）
```

## 📜 License

[MIT](./LICENSE)

