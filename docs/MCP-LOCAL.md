# Knowledge MCP adapter (local G2 preview)

This is a **localhost-only Streamable HTTP JSON-RPC subset**, not a deployed ChatGPT connection. The server binds 127.0.0.1 and responds to POST /mcp for MCP protocol version 2025-11-25. It rejects invalid Host and Origin, unauthenticated requests, unsupported protocol versions and invalid JSON-RPC. GET /mcp is not supported. There is no SSE streaming, OAuth, production TLS, remote sessions, prompts or resources.

The two separate bearer credentials grant:
- owner: list, search and read within one configured wiki workspace;
- agent: those reads plus knowledge_capture_draft, which can create or revise **draft** pages but cannot replace a human-reviewed entry, approve a decision or share any page.

Available tools: knowledge_list (read paths), knowledge_search (search content), knowledge_read (read one current record with provenance), knowledge_capture_draft (idempotent safe draft capture).

Source text is evidence and should be treated as **untrusted**; it never authorizes actions. No manual editor or Notion database clone is part of this feature.

## Synthetic local test

After following the README local setup, test initialization without exposing credentials:

~~~sh
curl -sS -X POST http://127.0.0.1:3189/mcp \
 -H "Authorization: Bearer $KNOWLEDGE_AGENT_TOKEN" \
 -H 'Content-Type: application/json' \
 -H 'Accept: application/json, text/event-stream' \
 -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"synthetic-test","version":"0.1"}}}'
~~~

Next, call tools/list with the same authorization headers and MCP-Protocol-Version: 2025-11-25, then use tools/call with a listed tool name and bounded arguments. Automated tests use fictional records in distinct workspaces.

## Release gates

ChatGPT cannot reach a localhost-only server directly. Real connection requires separately approved reachable HTTPS infrastructure, a supported remote authentication model, credential lifecycle, abuse resistance, permission review, and independent security tests. The current service **must not** be published directly online. An MCP adapter does not cause ChatGPT to automatically store every conversation. Notion remains authoritative until separately verified export, import, restore and owner-approved cutover.
