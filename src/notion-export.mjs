/**
 * Read-only inventory of an EXTRACTED Notion Markdown/CSV/HTML workspace export.
 * No user content is imported, summarized or logged. Sensitive manifest is optional
 * and must be written as an authenticated encrypted envelope.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { encryptSnapshot } from './backup.mjs';

export class ExportInspectionError extends Error {
  constructor(code, message) { super(message); this.name = 'ExportInspectionError'; this.code = code; }
}
const ID_END = /(?:^|[\s_-])([a-f0-9]{32})$/i;
const MAX_ENTRIES = 100_000;
const MAX_TOTAL_BYTES = 20 * 1024 ** 3;
const LINK_READ_LIMIT = 2 * 1024 ** 2;
const SENSITIVE_EXTENSIONS = new Set(['.md', '.csv', '.html']);
function sourceId(name) {
  const withoutExt = name.replace(/\.[^.]+$/u, '');
  const match = withoutExt.match(ID_END);
  return match ? match[1].toLowerCase() : null;
}
function category(path) {
  const ext = extname(path).toLowerCase();
  if (path.toLowerCase() === 'index.html') return 'sitemap';
  if (ext === '.md') return 'markdown';
  if (ext === '.csv') return 'database_csv';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'asset';
}
function csvSummary() {
  let inside = false, lines = 0, any = false, finalByte = 0, badNul = false;
  return {
    feed(chunk) {
      for (const byte of chunk) {
        if (byte === 0) badNul = true;
        if (byte === 34) inside = !inside; // escaped quotes toggle twice
        if (byte === 10 && !inside) lines++;
        any = true; finalByte = byte;
      }
    },
    done() {
      if (badNul || inside) return { rowCount: null, status: 'UNVERIFIED_CSV' };
      const totalRows = any ? lines + (finalByte === 10 ? 0 : 1) : 0;
      return { rowCount: Math.max(0, totalRows - 1), status: totalRows ? 'COUNTED_CSV_ROWS' : 'EMPTY_CSV' };
    },
  };
}
async function fingerprint(fullPath, scanCsv) {
  const sha = createHash('sha256');
  const csv = scanCsv ? csvSummary() : null;
  for await (const chunk of createReadStream(fullPath, { highWaterMark: 64 * 1024 })) {
    sha.update(chunk);
    if (csv) csv.feed(chunk);
  }
  return { sha256: sha.digest('hex'), ...(csv ? csv.done() : {}) };
}
function references(markdown, documentPath) {
  const values = [];
  // This is deliberately an approximation: multiline and custom Markdown are
  // flagged for later import fidelity review rather than silently certified.
  const matcher = /!?\[[^\]\n]*\]\((<?[^)\n]+>?)\)/gu;
  for (const match of markdown.matchAll(matcher)) {
    let candidate = match[1].trim().replace(/^<|>$/gu, '').split(/\s+"/u)[0];
    if (!candidate || candidate.startsWith('#') || /^(?:mailto:|tel:|data:)/iu.test(candidate)) continue;
    if (/^https?:\/\//iu.test(candidate)) {
      if (/^https?:\/\/(?:www\.)?notion\.(?:so|site)\//iu.test(candidate)) values.push({ kind: 'remote_notion', value: null });
      continue;
    }
    candidate = candidate.split('#')[0].split('?')[0];
    try { candidate = decodeURIComponent(candidate); }
    catch { values.push({ kind: 'invalid_encoding', value: null }); continue; }
    if (!candidate || isAbsolute(candidate) || candidate.includes('\\')) {
      values.push({ kind: 'unsafe_local', value: null }); continue;
    }
    const normalized = posix.normalize(posix.join(posix.dirname(documentPath), candidate));
    if (normalized.startsWith('../') || normalized === '..') values.push({ kind: 'unsafe_local', value: null });
    else values.push({ kind: 'local', value: normalized });
  }
  return values;
}
function deriveParentId(relPath) {
  const parts = relPath.split('/').slice(0, -1).reverse();
  for (const segment of parts) {
    const found = sourceId(segment);
    if (found) return found;
  }
  return null;
}

export async function inspectNotionExport(directory, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new ExportInspectionError('INVALID_ROOT', 'An extracted export directory is required');
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES ||
      !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > MAX_TOTAL_BYTES) {
    throw new ExportInspectionError('INVALID_LIMIT', 'Invalid read-only export inspection limits');
  }
  const root = resolve(directory);
  const initial = await lstat(root);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new ExportInspectionError('INVALID_ROOT', 'Export root must be a regular directory, not a symbolic link');
  const physicalRoot = await realpath(root);
  if (physicalRoot !== root) throw new ExportInspectionError('INVALID_ROOT', 'Export root may not traverse symlinks');
  const entries = [], warnings = [];
  let totalBytes = 0;
  async function walk(folder, depth = 0) {
    if (depth > 64) throw new ExportInspectionError('TOO_DEEP', 'Export nesting exceeds safety limit');
    for (const item of (await readdir(folder, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(folder, item.name);
      const st = await lstat(path);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw new ExportInspectionError('UNSAFE_EXPORT', 'Export includes symbolic links or nonregular files');
      if (st.isDirectory()) { await walk(path,depth+1); continue; }
      if (entries.length >= maxEntries) throw new ExportInspectionError('TOO_MANY_FILES', 'Export exceeds entry limit');
      totalBytes += st.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) throw new ExportInspectionError('TOO_LARGE', 'Export exceeds safety size limit');
      const rel = relative(root, path).split(sep).join('/');
      const type = category(rel);
      const fp = await fingerprint(path,type==='database_csv');
      const itemInfo = {
        relativePath: rel, type, originalNotionId: sourceId(basename(rel)), parentNotionId: deriveParentId(rel),
        bytes: st.size, sha256: fp.sha256, status: type==='asset' ? 'ARCHIVE_ONLY' : type==='sitemap' ? 'SITEMAP_ONLY' : type==='database_csv' ? fp.status : 'SOURCE_ONLY_NOT_IMPORTED',
        csvRows: fp.rowCount ?? null, linkCount: 0, missingLocalLinks: 0, remoteNotionLinks: 0,
      };
      if (SENSITIVE_EXTENSIONS.has(extname(rel).toLowerCase()) && !itemInfo.originalNotionId && type !== 'sitemap') {
        warnings.push({ code: 'NO_NOTION_ID', relativePath: rel });
      }
      if (type === 'html') warnings.push({ code:'HTML_FIDELITY_UNVERIFIED', relativePath: rel });
      if (type === 'database_csv' && fp.status === 'UNVERIFIED_CSV') warnings.push({ code:'UNVERIFIED_CSV', relativePath: rel });
      if (type === 'markdown') {
        if (st.size > LINK_READ_LIMIT) warnings.push({ code:'LARGE_MARKDOWN_NOT_LINK_CHECKED', relativePath: rel });
        else {
          const bytes=await readFile(path);
          try { itemInfo._links = references(new TextDecoder('utf-8', { fatal:true }).decode(bytes),rel); }
          catch { warnings.push({ code:'INVALID_UTF8_MARKDOWN', relativePath:rel }); }
        }
      }
      entries.push(itemInfo);
    }
  }
  await walk(root);
  const known = new Set(entries.map(x=>x.relativePath));
  const seen = new Map();
  for (const entry of entries) {
    if (entry.originalNotionId) {
      const match=seen.get(entry.originalNotionId);
      if (match) {
        warnings.push({ code:'DUPLICATE_NOTION_ID', relativePath:entry.relativePath });
        warnings.push({ code:'DUPLICATE_NOTION_ID', relativePath:match });
      } else seen.set(entry.originalNotionId,entry.relativePath);
    }
    for (const link of entry._links ?? []) {
      entry.linkCount++;
      if (link.kind === 'remote_notion') entry.remoteNotionLinks++;
      else if (link.kind !== 'local' || !known.has(link.value)) {
        entry.missingLocalLinks++;
        warnings.push({ code:link.kind==='local'?'BROKEN_LOCAL_LINK':'UNVERIFIED_LINK', relativePath:entry.relativePath });
      }
    }
    delete entry._links;
  }
  const byType = { markdown:0, database_csv:0, html:0, asset:0, sitemap:0 };
  let csvRows = 0, missingLinks=0, remoteLinks=0, missingIds=0;
  for (const entry of entries) {
    byType[entry.type]++;
    csvRows += entry.csvRows ?? 0;
    missingLinks += entry.missingLocalLinks;
    remoteLinks += entry.remoteNotionLinks;
    if (!entry.originalNotionId && (entry.type === 'markdown' || entry.type === 'database_csv' || entry.type === 'html')) missingIds++;
  }
  const warningCounts = {};
  for (const w of warnings) warningCounts[w.code]=(warningCounts[w.code]||0)+1;
  const summary = {
    inspectedFiles:entries.length, bytes:totalBytes, byType, databaseCsvRows:csvRows,
    originalNotionIds:seen.size, missingIds, missingLocalLinks:missingLinks, unresolvedRemoteNotionLinks:remoteLinks,
    warnings: warningCounts, fullFidelityCertified:false, imported:false, workspaceCoverageVerified:false,
  };
  // Deliberately do not include extracted source text in the manifest.
  return { format:'knowledge-notion-preflight-v1', summary, entries, warnings,
    requiredOwnerReview:['Access boundaries and omitted private pages','Separate family, professional and creative scopes','CSV schemas/relations and original IDs','Markdown/HTML fidelity and links','Assets requiring separate encrypted archival','Source record counts vs Notion API inventory','Latest changes since snapshot','Recovery of original export before any cutover'] };
}

async function main() {
  const [root, output, ...remaining] = process.argv.slice(2);
  if (!root || remaining.length || output==='--help') {
    console.error('Usage: node src/notion-export.mjs EXTRACTED_DIRECTORY [ENCRYPTED_MANIFEST_PATH]');
    process.exitCode=2; return;
  }
  try {
    const report = await inspectNotionExport(root);
    if (output) {
      const outputPath=resolve(output), inputPath=resolve(root);
      if (outputPath===inputPath || outputPath.startsWith(inputPath+sep)) {
        throw new ExportInspectionError('UNSAFE_DESTINATION', 'Keep encrypted manifest outside the extracted source directory');
      }
      const envelope = encryptSnapshot(report,process.env.KNOWLEDGE_BACKUP_PASSPHRASE);
      // A newly created file only; never overwrite existing export or archive.
      const handle=await open(output,'wx',0o600);
      try { await handle.writeFile(JSON.stringify(envelope)+'\n','utf8'); }
      finally { await handle.close(); }
    }
    process.stdout.write(JSON.stringify({ ...report.summary, encryptedManifestWritten: !!output },null,2)+'\n');
    if (Object.keys(report.summary.warnings).length) process.exitCode=3; // review required
  } catch(e) {
    const publicError=e instanceof ExportInspectionError ? e.message : 'Inspection failed; verify local file permissions and export integrity';
    process.stderr.write(JSON.stringify({ code:e.code||'INSPECTION_FAILED', error:publicError })+'\n');
    process.exitCode=1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
