import { z, ZodTypeAny } from 'zod';
import { registry } from './registry.js';

/**
 * 一个 HTTP 方法。
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * 路由入参的各部位校验（使用 zod schema）。
 * 前端与后端共享同一套 schema，因此入参/出参在两端完全类型一致。
 */
export interface RouteInput {
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  body?: ZodTypeAny;
  headers?: ZodTypeAny;
}

/**
 * 路由的「契约」元数据 —— 这是全栈的唯一事实来源（single source of truth）。
 * 前端 import type 这套元数据即可获得端到端类型；
 * 后端依据它自动生成路由、入参校验、文档与仪表盘配置。
 */
export interface RouteMeta {
  /** 路由唯一标识（不填则自动用 `METHOD path` 生成） */
  name?: string;
  method: HttpMethod;
  /** Fastify 风格路径，例如 /users/:id */
  path: string;
  /** API 版本号，生成时会自动加前缀 /v{n} */
  version?: number;
  summary?: string;
  description?: string;
  tags?: string[];
  input?: RouteInput;
  output?: ZodTypeAny;
  /** 访问该接口所需的权限 scope 列表（全部满足才放行） */
  scopes?: string[];
  /** 为 true 时跳过鉴权（公开接口） */
  public?: boolean;
}

/**
 * 处理器运行时的上下文。
 */
export interface RouteContext<I = any> {
  input: I;
  req: any;
  reply: any;
  /** Fastify 实例（可访问 .constrato.services 等） */
  app: any;
  /** 业务服务集合（由 bootstrap 注入） */
  services: any;
}

export type RouteHandler<I = any, O = any> = (ctx: RouteContext<I>) => Promise<O> | O;

/**
 * 一条完整的路由定义（契约 + 处理器）。
 */
export interface RouteDefinition {
  id: string;
  meta: RouteMeta;
  handler: RouteHandler;
}

function slug(meta: RouteMeta): string {
  return (meta.name || `${meta.method} ${meta.path}`).trim();
}

/**
 * 定义一条接口契约。
 *
 * 用法：
 * ```ts
 * export const getUser = defineRoute({
 *   method: 'GET',
 *   path: '/users/:id',
 *   input: { params: z.object({ id: z.string() }) },
 *   output: UserSchema,
 *   scopes: ['user:read'],
 * }).handler(async ({ input, services }) => {
 *   return services.users.findById(input.params.id);
 * });
 * ```
 *
 * 调用 `.handler()` 时会把该路由注册进全局 registry ——
 * 这就是「前端定义契约，后端自动生成」的核心机制：
 * 你只需写契约，路由、校验、文档、仪表盘全部自动就绪。
 */
export function defineRoute(meta: RouteMeta) {
  const id = slug(meta);
  return {
    meta,
    handler(fn: RouteHandler) {
      const def: RouteDefinition = { id, meta, handler: fn };
      registry.register(def);
      return def;
    },
  };
}

/** 把契约的 path 转成实际对外暴露的 path（含版本前缀）。 */
export function servedPath(meta: RouteMeta): string {
  const base = meta.path.startsWith('/') ? meta.path : `/${meta.path}`;
  if (meta.version && meta.version > 1) {
    return `/v${meta.version}${base}`;
  }
  return base;
}

/** 从 RouteInput 中推断处理后的输入类型（供前端客户端使用）。 */
export type ParsedInput<I extends RouteInput | undefined> = I extends RouteInput
  ? {
      [K in keyof I as K extends 'headers' ? never : K]?: I[K] extends ZodTypeAny
        ? z.infer<I[K]>
        : never;
    }
  : Record<string, never>;

/** 推断输出类型。 */
export type ParsedOutput<O extends ZodTypeAny | undefined> = O extends ZodTypeAny
  ? z.infer<O>
  : unknown;
