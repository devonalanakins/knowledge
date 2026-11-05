/**
 * OAuth 2.0 protected resource metadata (RFC 9728).
 * Discovery only: no token issuer, transport deployment, or user grants.
 */
export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

function httpsUrl(value,{mcp=false}={}) {
  if(typeof value !== 'string'||value.length<12||value.length>512)throw new TypeError('Expected an explicit HTTPS URL');
  let u;try{u=new URL(value)}catch{throw new TypeError('Invalid HTTPS URL')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.origin==='null'||
    (u.href!==value&&!(!mcp&&u.pathname==='/'&&u.href===value+'/')))throw new TypeError('Expected canonical HTTPS URL');
  if(mcp&&u.pathname!=='/mcp')throw new TypeError('Knowledge MCP resource must end in /mcp');
  if(!mcp&&u.pathname.endsWith('/')&&u.pathname!=='/')throw new TypeError('Authorization server path must be canonical');
  return u;
}
export function createMcpResourceMetadata({resource,authorizationServers}={}) {
  const uri=httpsUrl(resource,{mcp:true});
  if(!Array.isArray(authorizationServers)||authorizationServers.length<1||authorizationServers.length>4)
    throw new TypeError('One to four trusted authorization servers required');
  const issuers=authorizationServers.map(i=>{httpsUrl(i);return i});
  if(new Set(issuers).size!==issuers.length)throw new TypeError('Duplicate authorization servers');
  const metadata=Object.freeze({
    resource:uri.href,authorization_servers:Object.freeze([...issuers]),
    scopes_supported:Object.freeze(['knowledge.read','knowledge.write']),
    bearer_methods_supported:Object.freeze(['header']),
  });
  const metadataUrl=new URL(MCP_RESOURCE_METADATA_PATH,uri.origin).href;
  const challenge=({write=false,insufficient=false}={})=>{
    const fields=['resource_metadata="'+metadataUrl+'"',
      'scope="'+(write?'knowledge.read knowledge.write':'knowledge.read')+'"'];
    if(insufficient)fields.unshift('error="insufficient_scope"');
    return 'Bearer '+fields.join(', ');
  };
  return Object.freeze({metadata,metadataUrl,host:uri.host,
    readChallenge:challenge(),writeChallenge:challenge({write:true,insufficient:true})});
}
