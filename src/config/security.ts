import type { SecurityConfig } from '../core/security.js';

/**
 * 安全配置示例。
 *
 * 默认即「开发友好 + 基础防护」：安全响应头全开、CORS 反射任意源（本地联调方便）、
 * 全局限流与超时关闭（按需开启）。
 *
 * 上线前建议按需调整：
 *   - cors.origin 改为前端域名白名单（如 ['https://app.example.com']），并视情况开 credentials
 *   - 开启 globalRateLimit（如每 IP 每 60 秒 600 次）
 *   - 开启 requestTimeoutMs（如 15000）
 *   - 若部署在 Nginx / 网关后，把 trustProxy 设为 true
 */
export const security: SecurityConfig = {
  headers: true,
  cors: {
    // 开发期：反射任意源。生产请改成白名单数组，例如：
    // origin: ['https://app.example.com'],
    origin: true,
    credentials: false,
    maxAge: 600,
  },
  // bodyLimit: 1_048_576,                 // 1MB，按需调大
  // globalRateLimit: { max: 600, windowMs: 60_000 },
  // requestTimeoutMs: 15_000,
  // trustProxy: false,
};
