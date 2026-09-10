/** @type {import('next').NextConfig} */
export default {
  // The query layer lives in the parent package and is imported, not copied.
  transpilePackages: ['gameswarp-mcp'],
  experimental: { externalDir: true },
};
