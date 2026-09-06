const agentServerUrl = process.env.AGENT_SERVER_URL ?? 'http://127.0.0.1:3000';

const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${agentServerUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
