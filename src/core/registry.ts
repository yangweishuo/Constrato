import type { RouteDefinition } from './contract.js';

/**
 * 全局路由注册中心。
 *
 * 每个契约在调用 `.handler()` 时都会把自己登记进来，
 * server 启动后从这里读取全部路由并自动注册到 Fastify。
 * 仪表盘也通过这里 + store 渲染接口文档与管理界面。
 */
class Registry {
  private routes = new Map<string, RouteDefinition>();

  register(def: RouteDefinition): void {
    if (this.routes.has(def.id)) {
      // 允许热重载时覆盖（tsx watch）
      console.warn(`[constrato] 路由覆盖注册: ${def.id}`);
    }
    this.routes.set(def.id, def);
  }

  get(id: string): RouteDefinition | undefined {
    return this.routes.get(id);
  }

  all(): RouteDefinition[] {
    return [...this.routes.values()];
  }

  /** 用于在 Contract 客户端里按 id 列表面向所有路由生成类型安全的调用。 */
  ids(): string[] {
    return [...this.routes.keys()];
  }
}

export const registry = new Registry();

/**
 * 供前端「契约客户端」使用：根据 registry 中所有契约，推导出
 * { [routeId]: (input) => Promise<output> } 的强类型结构。
 */
export type ContractMap = {
  [D in RouteDefinition as D['id']]: (input: any) => Promise<any>;
};
