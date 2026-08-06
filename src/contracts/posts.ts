import { z } from 'zod';
import { defineRoute } from '../core/contract.js';

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
});
export type Post = z.infer<typeof PostSchema>;

const posts: Post[] = [
  {
    id: '1',
    title: '契约驱动开发初体验',
    content: '用一份 TS 契约同时驱动前后端，真香。',
    authorId: '1',
    createdAt: new Date().toISOString(),
  },
];

export const listPosts = defineRoute({
  name: 'listPosts',
  method: 'GET',
  path: '/posts',
  summary: '获取文章列表',
  tags: ['posts'],
  scopes: ['post:read'],
  output: z.array(PostSchema),
}).handler(async () => {
  return posts;
});

export const getPost = defineRoute({
  name: 'getPost',
  method: 'GET',
  path: '/posts/:id',
  summary: '获取单篇文章',
  tags: ['posts'],
  scopes: ['post:read'],
  input: { params: z.object({ id: z.string() }) },
  output: PostSchema,
}).handler(async ({ input }) => {
  const p = posts.find((x) => x.id === input.params.id);
  if (!p) throw Object.assign(new Error(`文章 ${input.params.id} 不存在`), { statusCode: 404 });
  return p;
});

export const createPost = defineRoute({
  name: 'createPost',
  method: 'POST',
  path: '/posts',
  summary: '发布文章',
  tags: ['posts'],
  scopes: ['post:write'],
  version: 2,
  input: {
    body: z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      authorId: z.string(),
    }),
  },
  output: PostSchema,
}).handler(async ({ input }) => {
  const post: Post = {
    id: String(posts.length + 1),
    title: input.body.title,
    content: input.body.content,
    authorId: input.body.authorId,
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  return post;
});
