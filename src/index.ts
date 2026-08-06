import { buildServer } from './core/server.js';
import { mountDashboard } from './dashboard/index.js';
import { store } from './core/store.js';
import { registry } from './core/registry.js';
import { databases } from './config/databases.js';
import './contracts/index.js'; // 副作用：注册所有契约路由

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // 1) 先确保 store / admin key 就绪
  const adminKey = await store.adminKey();

  // 2) 用已注册的契约 + 数据源配置构建 Fastify 服务
  const app = await buildServer({ logger: false, databases });

  // 3) 挂载仪表盘 + /__meta 管理接口
  await mountDashboard(app);

  // 4) 监听
  await app.listen({ port: PORT, host: HOST });

  const addr = `http://localhost:${PORT}`;
  console.log('\n  ⚡ Constrato 已启动');
  console.log(`     接口数:    ${registry.ids().length}`);
  console.log(`     仪表盘:    ${addr}/dashboard`);
  console.log(`     元数据:    ${addr}/__meta`);
  console.log(`     健康检查:  ${addr}/health`);
  console.log(`\n     🔑 管理密钥 (x-admin-key): ${adminKey}\n`);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
