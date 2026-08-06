/**
 * 可选数据库驱动的类型声明 shim。
 * Constrato 用动态 `import()` 按需加载这些驱动，属于可选依赖；
 * 没安装时不在 node_modules 里，tsc 会报 "Cannot find module"。
 * 这里把它们声明为 any，仅用于让类型检查通过——运行时真正加载由动态 import 负责。
 */
declare module 'pg';
declare module 'mysql2/promise';
declare module 'better-sqlite3';
declare module 'mssql';
declare module 'mongodb';
declare module 'redis';
declare module '@clickhouse/client';
