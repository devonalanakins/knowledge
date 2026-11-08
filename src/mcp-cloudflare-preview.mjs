/**
 * G9g: Cloudflare Access Managed OAuth synthetic MCP read-only origin.
 * Cloudflare handles the OAuth challenge/consent externally. The origin ONLY
 * validates its signed identity assertion, and never grants wiki writes.
 */
import { randomBytes } from 'node:crypto';
import { KnowledgeStore } from './knowledge.mjs';
import { createKnowledgeServer } from './server.mjs';
import { createCloudflareAccessReadVerifier } from './cloudflare-access-auth.mjs';
import { loadOperatorJson, SYNTHETIC_ACKNOWLEDGMENT } from './mcp-hosted-preview.mjs';

function refuse(message){throw new Error('Knowledge Cloudflare synthetic preview: '+message)}
const hostRE=/^[a-z0-9.-]{4,253}$/;
export function loadCloudflareSyntheticMcpConfig(env=process.env) {
  if(env.KNOWLEDGE_SYNTHETIC_ACK!==SYNTHETIC_ACKNOWLEDGMENT ||
     env.KNOWLEDGE_MCP_AUTH_MODE!=='CLOUDFLARE_MANAGED_OAUTH_READ_ONLY')
    refuse('explicit synthetic-only Cloudflare read-only mode required');
  if(env.KNOWLEDGE_DB!==undefined && env.KNOWLEDGE_DB!==':memory:')
    refuse('disk database path prohibited');
  const resource=env.KNOWLEDGE_MCP_RESOURCE;
  let url;
  try{url=new URL(resource);}catch{refuse('canonical HTTPS resource required')}
  if(url.protocol!=='https:'||url.pathname!=='/mcp'||url.href!==resource||
    url.search||url.hash||url.username||url.password||
    !hostRE.test(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.local'))
    refuse('canonical public HTTPS MCP resource required');
  const publicKeys=loadOperatorJson(env.KNOWLEDGE_CF_PUBLIC_JWKS_FILE);
  const principals=loadOperatorJson(env.KNOWLEDGE_CF_SUBJECTS_FILE);
  if(!publicKeys || Object.keys(publicKeys).length!==1 || !Array.isArray(publicKeys.keys) ||
    !principals || Object.keys(principals).length!==1 || !Array.isArray(principals.allowedSubjects))
    refuse('trusted Cloudflare public JWKS/subject documents required');
  let verifier;
  try{verifier=createCloudflareAccessReadVerifier({
    teamIssuer:env.KNOWLEDGE_CF_TEAM_ISSUER,
    appAudience:env.KNOWLEDGE_CF_APP_AUDIENCE,
    publicKeys:publicKeys.keys,
    allowedSubjects:principals.allowedSubjects
  });}catch{refuse('Cloudflare assertion issuer, audience, keys or subjects rejected')}
  const portString=env.KNOWLEDGE_MCP_PORT??'3189';
  if(!/^[0-9]{4,5}$/.test(portString))refuse('invalid loopback port');
  const port=Number(portString);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)refuse('invalid loopback port');
  return Object.freeze({port,mcpTokenVerifier:verifier,mcpTrustedProxy:true,
    mcpProxyHost:url.host,mcpReadOnly:true});
}
export function createCloudflareSyntheticMcpPreview(config) {
  if(!config||config.mcpTrustedProxy!==true||config.mcpReadOnly!==true||
    typeof config.mcpTokenVerifier!=='function'||!hostRE.test(config.mcpProxyHost??''))
    refuse('verified Cloudflare read-only config required');
  const store=new KnowledgeStore(':memory:');
  try {
    store.createSpace('personal','Fictional Knowledge Access preview');
    store.capturePage('personal',{path:'demo/cloudflare-readonly',
      title:'Cloudflare fictional read-only reference',
      body:'This is synthetic Knowledge MCP content. No private source data.',
      sourceUrl:'https://example.org/cloudflare-fixture'});
    const server=createKnowledgeServer(store,{
      ownerToken:randomBytes(32).toString('hex'),agentToken:randomBytes(32).toString('hex'),
      space:'personal',mcpTokenVerifier:config.mcpTokenVerifier,
      mcpTrustedProxy:true,mcpProxyHost:config.mcpProxyHost,mcpReadOnly:true
    });
    return Object.freeze({server,store});
  }catch(e){store.close();throw e}
}
