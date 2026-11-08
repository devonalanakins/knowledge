#!/usr/bin/env node
import { loadCloudflareSyntheticMcpConfig, createCloudflareSyntheticMcpPreview } from './mcp-cloudflare-preview.mjs';
process.umask(0o077);
try {
  const config=loadCloudflareSyntheticMcpConfig();
  const {server,store}=createCloudflareSyntheticMcpPreview(config);
  server.listen(config.port,'127.0.0.1',()=>{
    console.log('Knowledge synthetic Cloudflare read-only MCP origin: loopback port '+config.port);
    console.log('No Cloudflare Access app, OAuth client, DNS, tunnel, or real account verified.');
  });
  const stop=()=>server.close(()=>{store.close();process.exit(0)});
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch(e){console.error('Knowledge Cloudflare preview rejected:',e?.message||'invalid config');process.exitCode=1;}
