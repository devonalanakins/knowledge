# Knowledge private forward deployment — acceptance record

Date: 2026-11-07. Owner: DevonStation Knowledge. Status: **CLOUDFLARE RESOURCES PROVISIONED; EXTERNAL USER-PATH AND CHATGPT OAUTH NOT YET VERIFIED.**

This is a non-secret engineering handoff, not a private source-data inventory or a certification. The deployed Worker is for synthetic-only acceptance. **Do not write real personal, family, client or clinical records to it** until independent encryption-key recovery, backup/restore and consented ChatGPT write/readback have been proved.

## Confirmed Cloudflare resources

| Resource | Exact resource name | Observed state |
| --- | --- | --- |
| D1 database | `knowledge-forward-private` | Created; migration `ops/private-forward/schema.sql` applied; 3 Knowledge tables, one index, two immutable-revision triggers |
| Worker | `knowledge-forward-private` | Uploaded from `src/worker-cloudflare-private.mjs` on the active development branch; deployed; D1 binding attached |
| Access app | `Knowledge Forward — Owner Private` | Self-hosted application securing Worker and its public workers.dev hostname; one approved owner-only allow policy, no bypass policies reported |
| OAuth | Cloudflare Access Managed OAuth | Enabled; dynamic registration restricted to the ChatGPT stable redirect and callback-ID patterns |
| External endpoint | `https://knowledge-forward-private.devonakins.workers.dev/mcp` | Cloudflare reports workers.dev enabled, previews disabled; **external HTTP/OAuth handshake has not been independently tested** |

No Notion content was uploaded, and the live D1 row counts were **zero pages, zero revisions, zero instance marker** when checked. No production Knowledge record was saved.

The Worker has necessary private bindings, the actual Access application audience and a pinned owner identity. Values of encryption keys, Access audiences, private email addresses, Cloudflare account IDs and other sensitive configuration are deliberately excluded from this repository.

The current `KNOWLEDGE_DATA_KEY` was generated as an ephemeral *acceptance-only* Worker secret and **has no independently verified backup**. Therefore it MUST NOT become the production key. Draft capture is disabled by omission of `KNOWLEDGE_PRIVATE_WRITE_ACK`. Do not set this acknowledgment on the acceptance instance for real records.

## Security / acceptance still required

1. **External reachability and denial:** From a normal internet-connected browser/client verify the DNS endpoint; anonymous and wrong-user access must be denied. Verify that OAuth discovery, authorization and token refresh work. API configuration alone is not sufficient evidence.
2. **ChatGPT connection:** From ChatGPT on web, Plugins → Add custom MCP server; URL is the exact endpoint above; OAuth authentication through Cloudflare Access. Only owner may create/test this private plugin. Confirm tools `knowledge_list`, `knowledge_search`, `knowledge_read` appear. **`knowledge_capture_draft` must not be advertised in acceptance read-only mode.**
3. **Independent key custody:** On an independently controlled trusted device, generate and securely back up a unique new 256-bit production encryption root key. Never paste it into chat, GitHub, logs, screenshots or CI. Provision a separate reviewed production database/Worker or carefully reset the synthetic-only instance with explicit evidence before switching to the recoverable key.
4. **Real protected recovery:** Test independent encrypted database backup/restore and key recovery, scope isolation, wrong key failures, revision consistency and deploy rollback before any real owner data.
5. **Consented write/readback:** After the production key and backup pass, enable draft writes only for a non-sensitive fictional test, authenticate as the owner through ChatGPT, capture, search, read back exact content/revision and verify revocation and stale-write rejection. Then begin approved nonclinical owner records.
6. **Historical retirement is separate:** Original Notion ZIPs remain in protected owner storage; Notion is read-only. Do not sync, delete or disconnect the source until the independently approved retirement gate.

## Limitations

Current platform inventory and API responses verify configuration only. No external authentication was verified from this runtime: web retrieval could not access the newly created hostname, and local execution lacked external DNS resolution. This **does not** prove the host is unavailable to an ordinary browser. Do not infer successful access, live user functionality, ChatGPT installation or production suitability from a green CI run.

Cloudflare source/API documentation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/ .
Custom ChatGPT MCP setup: https://developers.openai.com/api/docs/guides/custom-mcp-server .
