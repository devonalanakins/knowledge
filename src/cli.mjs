#!/usr/bin/env node
/** Local-only operator command line. No remote credentials or implicit sync. */
import { readFile, writeFile } from 'node:fs/promises';
import { KnowledgeStore, KnowledgeError } from './knowledge.mjs';

const help = `Knowledge local operator CLI (not an authenticated multi-user service)
  knowledge --db PATH init SPACE "Workspace name"
  knowledge --db PATH add SPACE record.json
  knowledge --db PATH revise SPACE RECORD_ID EXPECTED_VERSION changes.json
  knowledge --db PATH read SPACE RECORD_ID
  knowledge --db PATH list SPACE
  knowledge --db PATH search SPACE words...
  knowledge --db PATH history SPACE RECORD_ID
  knowledge --db PATH link SPACE FROM_ID TO_ID KIND
  knowledge --db PATH capture SPACE page.json
  knowledge --db PATH share SPACE wiki/path
  knowledge --db PATH revoke SHARE_TOKEN
  knowledge --db PATH export SPACE output.json
  knowledge --db PATH restore snapshot.json
  knowledge --db PATH help

Never supply private record content as command-line arguments. Record JSON files may contain
kind, title, body, status, sourceUrl. Backups are plaintext: protect them separately.`;

async function inputJson(path) {
  const content = await readFile(path, 'utf8');
  if (content.length > 25_000_000) throw new KnowledgeError('INVALID_INPUT', 'Input file is too large');
  return JSON.parse(content);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('help') || argv[0] === '--help') {
    console.log(help);
    return;
  }
  if (argv[0] !== '--db' || !argv[1] || !argv[2]) {
    throw new KnowledgeError('INVALID_INPUT', 'Expected --db PATH COMMAND; see help');
  }
  const [dbPath, command, ...args] = argv.slice(1);
  process.umask(0o077);
  const store = new KnowledgeStore(dbPath);
  let result;
  try {
    switch (command) {
      case 'init':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected init SPACE NAME');
        result = store.createSpace(args[0], args[1]); break;
      case 'add':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected add SPACE record.json');
        result = store.createRecord(args[0], await inputJson(args[1])); break;
      case 'revise':
        if (args.length !== 4) throw new KnowledgeError('INVALID_INPUT', 'Expected revise SPACE ID VERSION changes.json');
        result = store.updateRecord(args[0], args[1], Number(args[2]), await inputJson(args[3])); break;
      case 'capture':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected capture SPACE page.json');
        result = store.capturePage(args[0], await inputJson(args[1])); break;
      case 'share':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected share SPACE PATH');
        result = store.createShare(args[0],args[1]); break;
      case 'revoke':
        if (args.length !== 1) throw new KnowledgeError('INVALID_INPUT', 'Expected revoke SHARE_TOKEN');
        result = store.revokeShare(args[0]); break;
      case 'read':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected read SPACE ID');
        result = store.getRecord(args[0], args[1]); break;
      case 'list':
        if (args.length !== 1) throw new KnowledgeError('INVALID_INPUT', 'Expected list SPACE');
        result = store.listRecords(args[0]); break;
      case 'search':
        if (args.length < 2) throw new KnowledgeError('INVALID_INPUT', 'Expected search SPACE terms');
        result = store.search(args[0], args.slice(1).join(' ')); break;
      case 'history':
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected history SPACE ID');
        result = store.history(args[0], args[1]); break;
      case 'link':
        if (args.length !== 4) throw new KnowledgeError('INVALID_INPUT', 'Expected link SPACE FROM TO KIND');
        result = store.link(...args); break;
      case 'export': {
        if (args.length !== 2) throw new KnowledgeError('INVALID_INPUT', 'Expected export SPACE output.json');
        const snapshot = store.exportSpace(args[0]);
        await writeFile(args[1], JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        result = { path: args[1], sha256: snapshot.sha256, records: snapshot.payload.records.length };
        break;
      }
      case 'restore':
        if (args.length !== 1) throw new KnowledgeError('INVALID_INPUT', 'Expected restore snapshot.json');
        result = store.restoreSpace(await inputJson(args[0])); break;
      default:
        throw new KnowledgeError('INVALID_INPUT', `Unknown command: ${command}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`${error.code || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  });
}
