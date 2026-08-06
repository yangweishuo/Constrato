import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * 根据 zod schema 生成一份「看起来真实」的 mock 数据。
 * 思路：先把 zod 转成 JSON Schema，再递归生成样例值。
 * 覆盖常见类型与 format（email/uuid/date-time/uri 等）。
 */
export function generateMock(schema?: z.ZodTypeAny, depth = 0): any {
  if (!schema) return null;
  let json: any;
  try {
    json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as any;
  } catch {
    json = {};
  }
  return fromJsonSchema(json, depth);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fromJsonSchema(schema: any, depth = 0): any {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) return null;

  // 处理 oneOf / anyOf
  if (Array.isArray(schema.oneOf)) return fromJsonSchema(schema.oneOf[0], depth);
  if (Array.isArray(schema.anyOf)) return fromJsonSchema(schema.anyOf[0], depth);

  const type = schema.type;

  if (type === 'object' || schema.properties) {
    const props = schema.properties || {};
    const out: Record<string, any> = {};
    for (const [key, sub] of Object.entries(props)) {
      out[key] = fromJsonSchema(sub, depth + 1);
    }
    return out;
  }

  if (type === 'array') {
    const itemSchema = schema.items || {};
    const len = Math.min(schema.maxItems ?? 3, 3);
    return Array.from({ length: Math.max(1, len) }, () => fromJsonSchema(itemSchema, depth + 1));
  }

  if (type === 'string') {
    return mockString(schema);
  }

  if (type === 'number' || type === 'integer') {
    const min = schema.minimum ?? 1;
    const max = schema.maximum ?? (schema.type === 'integer' ? 1000 : 1000);
    return Math.round(min + Math.random() * (max - min));
  }

  if (type === 'boolean') return Math.random() > 0.5;

  if (type === 'null') return null;

  return null;
}

function mockString(schema: any): string {
  const fmt = schema.format;
  const enums: string[] | undefined = schema.enum;
  if (enums && enums.length) return pick(enums);
  switch (fmt) {
    case 'email':
      return `user${rand(3)}@example.com`;
    case 'uuid':
      return crypto.randomUUID();
    case 'date-time':
      return new Date(Date.now() - rand(1000) * 86400000).toISOString();
    case 'date':
      return new Date(Date.now() - rand(1000) * 86400000).toISOString().slice(0, 10);
    case 'uri':
    case 'url':
      return `https://example.com/${rand(4)}`;
    case 'hostname':
      return `host-${rand(3)}.example.com`;
    default:
      if (schema.pattern) return `value${rand(3)}`;
      return `mock-${rand(4)}`;
  }
}

function rand(n: number): number {
  return Math.floor(Math.random() * Math.pow(10, n));
}
