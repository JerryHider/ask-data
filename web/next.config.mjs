const agentServerUrl = process.env.AGENT_SERVER_URL ?? 'http://127.0.0.1:3000';

const nextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  // 关闭 Next 层的 gzip 压缩：它会缓冲代理转发的 SSE 流，导致事件攒到最后才一起到达浏览器
  compress: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${agentServerUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
