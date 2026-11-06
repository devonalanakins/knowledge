#!/usr/bin/env node
/** G9d loopback-only synthetic fixture service; NOT production. */
import { loadSyntheticMcpConfig, createSyntheticMcpPreview } from './mcp-hosted-preview.mjs';

process.umask(0o077);
try {
  const config = loadSyntheticMcpConfig();
  const { server, store } = createSyntheticMcpPreview(config);
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Knowledge SYNTHETIC MCP origin listening on 127.0.0.1:${config.port}`);
    console.log('Private OAuth provider, HTTPS tunnel and external permissions NOT verified.');
  });
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  console.error('Knowledge synthetic preview rejected startup:', error?.message ?? 'invalid configuration');
  process.exitCode = 1;
}
