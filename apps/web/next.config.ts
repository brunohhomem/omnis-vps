const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@omnis/shared'],
  agentRules: false,
};

export default nextConfig;
