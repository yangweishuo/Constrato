import { z } from 'zod';
import { defineRoute } from '../core/contract.js';

/* ---------- 数据模型（契约的核心：前后端共享同一份 schema） ---------- */

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'guest']),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

// 进程内内存数据（演示用；真实项目把这里换成数据库 + ctx.services）
const users: User[] = [
  { id: '1', name: '张三', email: 'zhangsan@example.com', role: 'admin', createdAt: new Date().toISOString() },
  { id: '2', name: '李四', email: 'lisi@example.com', role: 'member', createdAt: new Date().toISOString() },
];

/* ---------- 接口契约：每个 defineRoute 都会自动生成路由+校验+文档 ---------- */

export const listUsers = defineRoute({
  name: 'listUsers',
  method: 'GET',
  path: '/users',
  summary: '分页获取用户列表',
  tags: ['users'],
  scopes: ['user:read'],
  input: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      role: z.enum(['admin', 'member', 'guest']).optional(),
    }),
  },
  output: z.object({
    total: z.number(),
    items: z.array(UserSchema),
  }),
}).handler(async ({ input }) => {
  let items = users;
  if (input.query.role) items = items.filter((u) => u.role === input.query.role);
  const total = items.length;
  const start = (input.query.page - 1) * input.query.limit;
  return { total, items: items.slice(start, start + input.query.limit) };
});

export const getUser = defineRoute({
  name: 'getUser',
  method: 'GET',
  path: '/users/:id',
  summary: '获取单个用户',
  tags: ['users'],
  scopes: ['user:read'],
  input: { params: z.object({ id: z.string() }) },
  output: UserSchema,
}).handler(async ({ input }) => {
  const user = users.find((u) => u.id === input.params.id);
  if (!user) throw notFound(`用户 ${input.params.id} 不存在`);
  return user;
});

export const createUser = defineRoute({
  name: 'createUser',
  method: 'POST',
  path: '/users',
  summary: '新建用户',
  tags: ['users'],
  scopes: ['user:write'],
  input: {
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      role: z.enum(['admin', 'member', 'guest']).default('member'),
    }),
  },
  output: UserSchema,
}).handler(async ({ input }) => {
  const user: User = {
    id: String(users.length + 1),
    name: input.body.name,
    email: input.body.email,
    role: input.body.role,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  return user;
});

export const updateUser = defineRoute({
  name: 'updateUser',
  method: 'PUT',
  path: '/users/:id',
  summary: '更新用户',
  tags: ['users'],
  scopes: ['user:write'],
  input: {
    params: z.object({ id: z.string() }),
    body: z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      role: z.enum(['admin', 'member', 'guest']).optional(),
    }),
  },
  output: UserSchema,
}).handler(async ({ input }) => {
  const user = users.find((u) => u.id === input.params.id);
  if (!user) throw notFound(`用户 ${input.params.id} 不存在`);
  Object.assign(user, input.body);
  return user;
});

export const deleteUser = defineRoute({
  name: 'deleteUser',
  method: 'DELETE',
  path: '/users/:id',
  summary: '删除用户',
  tags: ['users'],
  scopes: ['user:write'],
  input: { params: z.object({ id: z.string() }) },
  output: z.object({ ok: z.boolean() }),
}).handler(async ({ input }) => {
  const idx = users.findIndex((u) => u.id === input.params.id);
  if (idx < 0) throw notFound(`用户 ${input.params.id} 不存在`);
  users.splice(idx, 1);
  return { ok: true };
});

/* 简单的领域错误，会被 Fastify 捕获并返回 500（演示用） */
function notFound(message: string): Error {
  const e = new Error(message);
  (e as any).statusCode = 404;
  return e;
}
