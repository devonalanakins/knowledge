# Knowledge forward D1 — owner-only browser slice

**Status:** reviewable source with synthetic integration tests; **not deployed or enabled**. This is an independent, read-only browser view on the existing Cloudflare Access-protected `knowledge-forward-private` MCP Worker. It does not replace the worker, move the D1 database, enable ordinary writes, migrate Notion or introduce public sharing.

## Private routes and controlled enablement

The `/mcp` endpoint is unchanged. Five browser route patterns become available **only** with the additional nonsecret binding `KNOWLEDGE_BROWSER_ACK=OWNER_ONLY_BROWSER_READ_V1`:

- `GET /wiki`: private page list (up to 100 visible; live encrypted index currently supports up to 500).
- `GET /wiki-find?q=...`: bounded search across pages available to the **currently configured single owner workspace**.
- `GET /wiki/page/<path>`: read the latest authenticated draft at an exact valid Knowledge wiki path.
- `GET /wiki/history/<path>`: list all authenticated immutable revisions for one draft.
- `GET /wiki/revision/<path>/<version>`: view an exact authenticated historical revision without changing the current page.

Every page is server-rendered from decrypted records **in memory only**, with escaped untrusted title/body/query/source text and no client-side script, analytics, or external media. Responses use `no-store`, restrictive CSP, `noindex`, `nosniff`, and `no-referrer`. The layout supports desktop and narrow/mobile viewports, visible keyboard focus and reduced motion.

Historical routes require every immutable revision for the requested page to authenticate and match a contiguous version chain; missing or altered revisions fail closed rather than showing a partial history.

The same direct Cloudflare `ctx.access` assertion, fixed Access audience and separately configured owner email are required **before any page is read**. Missing, wrong or forged identities fail closed. Exact host and path matching block requests to unrelated endpoints. The existing encrypted-instance marker is verified and **every** stored ciphertext must authenticate before a library or search page is rendered. Wrong keys, damaged ciphertext and unrecognized URL shapes cannot expose content.

## Release limitations

- **Do not add the ACK to deployed Worker without a separate deployment review and owner approval.** The current Cloudflare connection is functioning and fictional-only; production remains unchanged.
- This source-only browser has not yet passed an authenticated, hosted desktop/iPhone acceptance test, including Cloudflare ingress and actual consent/session behavior.
- This is a read-only private viewer of the *forward* D1 drafts, not the historical Notion archive; no attachments, rich editing, publication controls, collection sharing, multi-tenant permissions or protected quarantine access.
- The single-owner configured `KNOWLEDGE_SPACE` is a trusted deployment setting, not a per-user ACL. Any expanded workspace/role/shared surface requires separate server-side permissions and a security review.
- Even when running locally, owner identity and encrypted D1 are required; this page is **not** a fallback if Access is down. Do not expose the origin directly to the internet.
- Search is passed as a URL query; it may appear in owner browser history or infrastructure URL logs. Do not use sensitive client/clinical queries on this pre-release slice.
- The browser imports no original ZIPs, has no Notion write path, and cannot bypass `KNOWLEDGE_ACCEPTANCE_ONLY_ACK` or grant unrestricted writing.
- **Notion cutover remains NO-GO** until source reconciliation, ownership, independent backups/owner-key restore, secure normal writer, actual hosted desktop/mobile validation and separate final retirement approval.

Tests: `node --test test/forward-private-browser.test.mjs test/worker-cloudflare-private.test.mjs`, then full `npm run check && npm test` on Node 22 and 24 via Actions before any integration to the development branch.
