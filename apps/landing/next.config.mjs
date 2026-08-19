import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX({
  outDir: 'src/generated-docs',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
};

export default withMDX(nextConfig);
