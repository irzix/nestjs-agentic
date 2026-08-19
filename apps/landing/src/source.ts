import { docs, meta } from './generated-docs/server';
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: toFumadocsSource(docs, meta),
});
