const agentServerUrl = process.env.AGENT_SERVER_URL ?? 'http://127.0.0.1:3000';

const nextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${agentServerUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
