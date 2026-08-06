/**
 * 契约汇总入口。
 *
 * 只要 `import` 本文件，所有契约的 `.handler()` 副作用就会把路由注册进全局 registry，
 * 后端与仪表盘随即「自动」拥有这些接口 —— 无需任何手工路由绑定。
 *
 * 新增一个接口 = 新建一个 defineRoute 文件 + 在这里 import 一下即可。
 */
import './health.js';
import './users.js';
import './posts.js';
import './system.js';

export * from './health.js';
export * from './users.js';
export * from './posts.js';
export * from './system.js';
