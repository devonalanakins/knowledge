/**
 * G9d: operator-configured, synthetic-only MCP host bootstrap.
 * NOT an OAuth authorization server, a ChatGPT connection, or production.
 * No private Knowledge database can be opened by this entrypoint.
 */
import { constants } from 'node:fs';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { KnowledgeStore } from './knowledge.mjs';
import { createKnowledgeServer } from './server.mjs';
import { createMcpAccessTokenVerifier } from './mcp-token-auth.mjs';
import { createMcpResourceMetadata } from './mcp-resource.mjs';

const MAX_CONFIG_BYTES = 65_536;
export const SYNTHETIC_ACKNOWLEDGMENT = 'SYNTHETIC_ONLY_NO_PRIVATE_DATA';

function invalid(message) {
  throw new Error('Knowledge synthetic MCP preview: ' + message);
}
function exactly(object, fields) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === fields.length &&
    fields.every(field => Object.hasOwn(object, field));
}
export function loadOperatorJson(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    invalid('require an absolute trusted configuration file path');
  }
  let handle;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 2 ||
        info.size > MAX_CONFIG_BYTES || (info.mode & 0o077) !== 0) {
      invalid('configuration files must be bounded, regular and owner-only (0600)');
    }
    handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(handle);
    if (!opened.isFile() || opened.size !== info.size ||
        opened.dev !== info.dev || opened.ino !== info.ino ||
        (opened.mode & 0o077) !== 0) {
      invalid('trusted configuration file changed during opening');
    }
    const bytes = readFileSync(handle);
    if (bytes.length !== opened.size || bytes.length > MAX_CONFIG_BYTES) {
      invalid('trusted configuration file changed during reading');
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error?.message?.startsWith('Knowledge synthetic MCP preview:')) throw error;
    invalid('failed to read trusted configuration file');
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/** Validate all trust inputs BEFORE constructing the server or storing content. */
export function loadSyntheticMcpConfig(env = process.env) {
  if (env.KNOWLEDGE_SYNTHETIC_ACK !== SYNTHETIC_ACKNOWLEDGMENT) {
    invalid('explicit synthetic-only acknowledgment required');
  }
  if (env.KNOWLEDGE_DB !== undefined && env.KNOWLEDGE_DB !== ':memory:') {
    invalid('disk database paths are forbidden in this preview');
  }
  const resource = env.KNOWLEDGE_MCP_RESOURCE;
  const issuer = env.KNOWLEDGE_MCP_ISSUER;
  let discovery;
  try {
    discovery = createMcpResourceMetadata({ resource, authorizationServers: [issuer] });
  } catch {
    invalid('require exact canonical HTTPS resource and trusted OAuth issuer URLs');
  }
  const resourceUrl = new URL(discovery.metadata.resource);
  if (['localhost', '127.0.0.1', '[::1]'].includes(resourceUrl.hostname) ||
      resourceUrl.hostname.endsWith('.local')) {
    invalid('the advertised resource must not be a localhost/private host');
  }
  const jwks = loadOperatorJson(env.KNOWLEDGE_MCP_JWKS_FILE);
  const subjects = loadOperatorJson(env.KNOWLEDGE_MCP_SUBJECTS_FILE);
  if (!exactly(jwks, ['keys']) || !Array.isArray(jwks.keys) ||
      !exactly(subjects, ['allowedSubjects']) || !Array.isArray(subjects.allowedSubjects)) {
    invalid('invalid JWKS or principal allowlist format');
  }
  let verifier;
  try {
    verifier = createMcpAccessTokenVerifier({
      issuer,
      audience: discovery.metadata.resource,
      publicKeys: jwks.keys,
      allowedSubjects: subjects.allowedSubjects,
    });
  } catch {
    invalid('trusted signing keys or principal allowlist rejected');
  }
  const portText = env.KNOWLEDGE_MCP_PORT ?? '3189';
  if (!/^[0-9]{4,5}$/.test(portText)) invalid('invalid loopback port');
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) invalid('port out of range');
  return Object.freeze({
    port,
    mcpTokenVerifier: verifier,
    mcpResource: Object.freeze({ resource, authorizationServers: Object.freeze([issuer]) }),
    mcpTrustedProxy: true,
  });
}

/** No uploads, private databases or real Notion content are accepted. */
export function createSyntheticMcpPreview(config) {
  if (!config || config.mcpTrustedProxy !== true ||
      typeof config.mcpTokenVerifier !== 'function' ||
      !config.mcpResource) invalid('trusted synthetic server configuration required');
  const store = new KnowledgeStore(':memory:');
  try {
    store.createSpace('personal', 'Fictional wiki preview');
    store.capturePage('personal', {
      path: 'demo/synthetic-connector',
      title: 'Synthetic Knowledge connector',
      body: '## Synthetic fixture\nThis is fictional data for testing OAuth-scoped wiki retrieval.',
      sourceUrl: 'https://example.org/synthetic-fixture',
    });
    const server = createKnowledgeServer(store, {
      ownerToken: randomBytes(32).toString('hex'),
      agentToken: randomBytes(32).toString('hex'),
      space: 'personal',
      mcpTokenVerifier: config.mcpTokenVerifier,
      mcpResource: config.mcpResource,
      mcpTrustedProxy: true,
    });
    return Object.freeze({ server, store });
  } catch (error) {
    store.close();
    throw error;
  }
}
