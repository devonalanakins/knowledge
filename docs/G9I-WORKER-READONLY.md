# G9i — Fictional-only Cloudflare Worker MCP adapter

**Status: SOURCE ONLY / release NO-GO.** This is a separate deployment candidate, not a replacement for the existing local Node/SQLite wiki. No Cloudflare resource, DNS, Access application, Managed OAuth setting, account link, database, or real data has been created.

## Purpose

The previous synthetic MCP origin runs a Node server on loopback. `src/worker-cloudflare-synthetic.mjs` now offers a much smaller stateless Cloudflare Worker alternative for the **first actual read-only GPT connection test**. It imports the portable `dispatchMcp` function, with no `node:sqlite` or other Node runtime module in its dependency tree, and serves one hard-coded fictional page. There is no database, storage binding, migration importer, editor, write method, or operator account list in source.

Cloudflare Access must authenticate the **direct Worker invocation**, providing a genuine platform-issued `ctx.access` object. The Worker independently enforces the expected audience and a single allowlisted email; injected identity headers or an opaque bearer token cannot authenticate it. Do not insert a Service Binding, Worker-with-Static-Assets router, or an unprotected reverse proxy in front of this handler: `ctx.access` does not transit those paths. If not authenticated, missing config, wrong audience/identity, wrong endpoint or wrong method, the Worker refuses to return wiki records.

The Worker exposes only `POST /mcp` with `knowledge_list`, `knowledge_search`, `knowledge_read`. It uses the same MCP protocol version, scoped dispatch semantics, OAuth tool metadata and read-only annotations as G9h. Attempting `knowledge_capture_draft` fails, even with forged client authorization headers. Request bodies are limited to 32,768 bytes. Search returns a fictional page only. All responses have `Cache-Control: no-store`.

## Required operator-supplied environment values (no values in Git)

| Variable | Meaning |
| --- | --- |
| `KNOWLEDGE_WORKER_SYNTHETIC_ACK` | Must equal `SYNTHETIC_ONLY_NO_PRIVATE_DATA` |
| `KNOWLEDGE_WORKER_RESOURCE` | Exact canonical HTTPS resource, e.g. `https://knowledge.example.test/mcp` (illustration only) |
| `KNOWLEDGE_ACCESS_AUD` | Actual audience identifier of the dedicated Cloudflare Access application |
| `KNOWLEDGE_ACCESS_EMAIL` | Lowercase email of the single explicitly authorized test operator |

These variables configure **only a synthetic read-only test**. Never add personal addresses, credentials, JWTs, exported Notion files, or production environment settings to a Git commit or PR.

## Explicit external deployment gates

1. Owner reviews the separate Worker name, domain, allowed identity, Cloudflare Access policy, Worker routing, possible plan limits and rollback approach before any resource or DNS change.
2. Every entrypoint to the Worker (including generated `workers.dev`, custom routes, and preview deployments) must be protected or verified to fail closed. Use direct Access-protected Worker invocation with the matching audience. Verify `ctx.access` is actually present from Cloudflare, not merely simulated as in tests.
3. Explicitly enable Managed OAuth on the intended Access application. Its OAuth discovery and consent handling belong to Cloudflare, not this Worker. Confirm the intended ChatGPT client supports the required authorization flow. Do not add a second OAuth issuer behind Managed OAuth.
4. Test an unauthorized browser/API request (deny), valid owner OAuth read (one fictional page), wrong identity/audience (deny), `knowledge_capture_draft` (deny), alternate hostname (deny) and actual end-user consent. Independently verify no response stores or exposes a real record.
5. Keep `main`, the real Notion workspace, and production Knowledge storage unchanged. Revoke the test Access application / disable routes if security or routing behavior differs from expectations.

## Local test evidence

The repository CI runs `npm run check` and `npm test` on Node.js 22 and 24; `test/worker-cloudflare-synthetic.test.mjs` simulates the Worker Request/Response and `ctx.access` surface. **Mocking `ctx.access` does not verify real Cloudflare Access or ChatGPT account linking.** Integration approval requires live tests with fictional data only.

Cloudflare references:

- [Workers Access `ctx.access` and limitations](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)

## Production separation

Do not treat this as a deployment authorization or a production database design. The Node/SQLite wiki keeps its separate security and encryption gates. A future Knowledge service that ingests private personal, business, family or clinical records needs properly reviewed identity, per-workspace authorization, encrypted persistent storage and independently restorable archives. The real Notion migration is still blocked.
