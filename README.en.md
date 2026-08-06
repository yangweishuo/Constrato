> Other languages: [中文](./README.zh.md)

# ⚡ Constrato

> A backend **driven by the frontend contract** — a full-stack pattern that unifies the dashboard and API management.

Constrato is an open-source TypeScript backend framework built on [Fastify](https://fastify.dev) + [Zod](https://zod.dev).
Core idea: **you write a single interface contract (`defineRoute`), and the backend auto-generates routes, input validation, docs, and a dashboard** — while the frontend gets end-to-end type safety from that same contract.

```
┌─────────────┐     one shared TS contract   ┌──────────────────┐
│  Frontend   │ ──── contract.ts ─────────▶ │  Constrato backend │
│  createClient│ ◀── end-to-end types ─────│  auto-registers   │
└─────────────┘                            │  routes/dashboard │
                                           └──────────────────┘
```

## ✨ Features

- **Contract-first**: a single `defineRoute` describes method / path / input / output / scopes, and shares one Zod schema across frontend and backend.
- **Auto-generation**: contracts register themselves as real routes at startup (with validation, auth, rate limiting, Mock) — no hand-written route bindings.
- **Built-in dashboard** (`/dashboard`):
  - 📖 Auto API docs (generated from schemas)
  - 🧪 Live debugging (form-based requests + real-time responses)
  - 🎭 Mock mode (fake data from the output schema, skipping real logic)
  - 🔖 Versioning (set `version` in a contract to auto-add a `/v{n}` prefix)
  - 🔐 Access control (scope-based auth + API Key issue/revoke)
  - ⏱ Rate-limit config (per-route, editable at runtime, no restart)
  - 🗄 Data-source status (multi-type DB connection health, three-state view)
  - 🔒 Security posture (headers / CORS / rate-limit / timeout scoring and hardening tips)

## 🚀 Quick Start

```bash
npm install
npm run dev          # dev mode (tsx watch)
# or
npm start            # production mode (tsx)
```

After startup:

- Dashboard: http://localhost:3000/dashboard
- Metadata:  http://localhost:3000/__meta
- Health:    http://localhost:3000/health

> Entering the dashboard requires an `x-admin-key`, which is **printed in the startup log**. Paste it into the console (stored only in the browser's localStorage).

## ✍️ Writing an API

Create a file under `src/contracts/`, describe it with `defineRoute`, and attach a handler:

```ts
import { z } from 'zod';
import { defineRoute } from '../core/contract.js';

export const getUser = defineRoute({
  name: 'getUser',
  method: 'GET',
  path: '/users/:id',
  summary: 'Get a single user',
  tags: ['users'],
  scopes: ['user:read'],
  input: { params: z.object({ id: z.string() }) },
  output: z.object({ id: z.string(), name: z.string() }),
}).handler(async ({ input, services }) => {
  return services.users.findById(input.params.id);
});
```

Then `import './yourfile.js';` in `src/contracts/index.ts` — routes, validation, docs, and the debug panel are **all ready automatically**.

## 🧩 Using it on the Frontend

The frontend gets a type-safe client from the same contract:

```ts
import { createClient } from 'constrato/core/client.js';

const client = createClient('http://localhost:3000', { apiKey: 'cdk_xxx' });
const user = await client.getUser({ params: { id: '1' } }); // fully typed
```

`createClient` reads the contract registry directly, so **any new or changed contract instantly gains a matching client method**.

## 🗄 Database Connections (multi-type)

Constrato also makes database connections **config-driven + adapter-based**: at startup it connects every database from config and injects the handles into each contract's `ctx.services.databases` (also exposed by name, e.g. `ctx.services.main`), and shows live connection health in the dashboard's "Data Sources" page.

Supported types (drivers are dynamically `import()`-ed on demand; missing a driver only degrades that one source gracefully, without taking down the core):

| Type | Driver package | Notes |
|---|---|---|
| `memory` | built-in | In-process memory, **zero-dependency**, works out of the box |
| `postgres` | `pg` | PostgreSQL |
| `mysql` / `mariadb` | `mysql2` | MySQL / MariaDB |
| `sqlite` | `better-sqlite3` | Local file or in-memory |
| `sqlserver` | `mssql` | SQL Server |
| `mongodb` | `mongodb` | Document database |
| `redis` | `redis` | Key-value / cache |
| `clickhouse` | `@clickhouse/client` | Analytical columnar store |
| `custom` | your own | Extend with any DB via `connectFn` or `driver` |

Configuration (`src/config/databases.ts`, imported by `src/index.ts`):

```ts
import type { DatabaseConfig } from '../core/database.js';

export const databases: DatabaseConfig[] = [
  { name: 'main', type: 'memory', enabled: true },                 // zero-dep, ready
  { name: 'pg',   type: 'postgres',  enabled: false, url: 'postgres://user:pass@localhost:5432/app' },
  { name: 'mysql',type: 'mysql',     enabled: false, host: 'localhost', port: 3306, user: 'root', password: '', database: 'app' },
  { name: 'mongo',type: 'mongodb',   enabled: false, url: 'mongodb://localhost:27017/app' },
  { name: 'redis',type: 'redis',     enabled: false, url: 'redis://localhost:6379' },
];
```

Install the driver before enabling a type: `npm i pg` (same for others, see table). Then set that item's `enabled` to `true`.

**Using a data source in a contract**:

```ts
export const listUsers = defineRoute({
  name: 'listUsers', method: 'GET', path: '/users',
  // ...
}).handler(async ({ services }) => {
  const db = services.main;            // the handle named 'main' in config
  const rows = await db.query('SELECT * FROM users'); // postgres/mysql/sqlite/sqlserver
  return rows;
});
```

Use `handle.raw(...)` for native clients such as MongoDB / Redis.

**A failed connection never crashes startup.** Each source degrades independently and has exactly three states:

| State | Meaning | Counts toward overall health? |
|---|---|---|
| `ok` | Connected normally | ✅ Yes |
| `down` | Enabled but unreachable (missing driver / network / unsupported) | ✅ Yes — turns overall health red |
| `disabled` | `enabled: false` in config (intentionally off) | ❌ No |

This way, keeping disabled sources in the config as "templates" won't pollute the health check. A disabled handle still exists, but calling its `query()` / `raw()` throws an explicit error instead of silently returning empty.

Check status:

- `GET /system/health` — public, returns `ok` + each source's `status`
- `GET /__meta/databases` — requires admin key; includes latency, failure reason, and categorized counts
- Dashboard "🗄️ Data Sources" page — healthy / down / disabled in three colors

## 🔒 Security

Constrato ships a **config-driven, secure-by-default** protection layer. All capabilities live in `src/core/security.ts`, configured via `src/config/security.ts`, and passed to `buildServer({ security })`.

Defaults (dev-friendly, still lets you integrate):

- ✅ All security headers on (HSTS / `X-Content-Type-Options: nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy` / response-type-aware `Content-Security-Policy`), and the `server` / `x-powered-by` fingerprint headers are removed
- ⚠️ CORS reflects any origin (handy for local dev, must be a whitelist in production)
- ⚠️ Global rate limit / request timeout are off by default (enable as needed)

Config example (`src/config/security.ts`):

```ts
import type { SecurityConfig } from '../core/security.js';

export const security: SecurityConfig = {
  headers: true,                         // security headers (on by default)
  cors: {
    origin: ['https://app.example.com'], // whitelist in prod; use true in dev (reflect any origin)
    credentials: false,
    maxAge: 600,
  },
  // bodyLimit: 1_048_576,               // per-request body cap (default 1MB)
  // globalRateLimit: { max: 600, windowMs: 60_000 }, // IP-based global limiter, anti-abuse/DoS
  // requestTimeoutMs: 15_000,           // request timeout, anti-slowloris
  // trustProxy: true,                   // enable behind Nginx / gateway so IP is trusted
};
```

Capability matrix:

| Capability | Config key | Default | Notes |
|---|---|---|---|
| Security headers | `headers` | on | HSTS / nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP |
| Fingerprint hiding | `exposeServerHeader` | off | Removes `server` / `x-powered-by` |
| CORS | `cors.origin` | reflect any | Use an origin-array whitelist in production |
| Body limit | `bodyLimit` | 1MB | Guards against oversized payloads |
| Global rate limit | `globalRateLimit` | off | IP-based sliding window protecting /, /dashboard, public routes, etc. |
| Request timeout | `requestTimeoutMs` | off | Hard-aborts slow connections at the Node layer, anti-slowloris |
| Proxy trust | `trustProxy` | off | Enable behind a reverse proxy so `req.ip` / limiter fingerprints are trusted |

> Contract-level "API Key + scope auth" and "per-route rate limit" are still provided by `src/core/auth.ts` + the route `preHandler` (see each `defineRoute`'s `scopes` and the `rateLimit` in `/__meta`), complementing this layer.

Check the security posture:

- `GET /__meta/security` — requires admin key; returns the current config and hardening tips
- Dashboard "🔒 Security" page — posture score (compliant / needs hardening), per-capability switches, active headers list, risk warnings
- Also, the static-asset endpoint is hardened against path traversal: the resolved real path must stay inside `public/`, otherwise 403

## 🗂 Project Structure

```
src/
  core/            # framework core (contract, registry, services, mock, auth, client, database, security)
    contract.ts    # defineRoute / RouteMeta — the single source of truth
    registry.ts    # global route registry
    server.ts      # builds the Fastify server from contracts
    store.ts       # runtime config persistence (mock/limit/permission/keys)
    mock.ts        # mock data from zod schemas
    auth.ts        # API Key + scope auth
    client.ts      # typed frontend client
    database.ts    # multi-type DB layer (adapter + config-driven)
    security.ts    # security layer (headers / CORS / rate-limit / timeout)
  config/          # runtime config (databases.ts / security.ts)
  contracts/       # your API contracts (shared with the frontend)
  dashboard/       # dashboard (/__meta API + static assets)
  index.ts         # entry point
data/              # runtime persisted data (gitignored)
```

## 📜 License

[MIT](./LICENSE)
