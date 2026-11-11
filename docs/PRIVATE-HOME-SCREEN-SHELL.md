# Knowledge private home-screen shell — source-only

Status: scoped implementation, **not** a claim that the live site has been updated or that offline editing is available.

## Behavior

- A signed-in owner can open the private Knowledge website in a standalone-capable browser and add it to a device's home screen using the browser/OS UI.
- All owner HTML includes `<link rel="manifest" href="/wiki/manifest.webmanifest">` and an SVG icon link, with product name **Knowledge** and the owner-approved branching neural-K silhouette.
- The server returns `GET /wiki/manifest.webmanifest` and `GET /wiki/icon.svg` **only** through the existing `KNOWLEDGE_BROWSER_ACK` route and direct Cloudflare Access owner identity. Wrong origin, query, unauthorized identity and POST/HEAD are rejected. No external hosting or registration.
- The manifest uses `/wiki/explore` for its start URL and `/wiki` scope. No private title, tenant identifier, path, token, secret, or domain is embedded.
- The HTML CSP remains default-deny and only permits `manifest-src 'self'` and `img-src 'self'` for these resources. No JavaScript, public sharing, new secret, background fetch, service worker, or local/private data cache.
- App-like mode is **not** offline capability. Browsing and editing still require a live authenticated connection. Any app/platform installability indication must be verified on an actual device.

## Limitations and release gates

- The SVG icon uses the exact approved vector path. iOS-specific home-screen icon rendering remains to be independently verified; a correctly sized PNG Apple touch icon may still be necessary for consistent appearance. Do **not** describe app-icon parity as verified on iOS merely because synthetic Chromium tests pass.
- This is a no-data, no-schema, no-API-change slice. No file upload/download, guest access, organization switcher, Notion retirement, public snapshots, service worker, offline revision queue, push notification or automatic synchronization is enabled.
- Before a production rollout: verify Cloudflare Access continues to require the authorized owner; test authenticated home-screen behavior on actual iPhone and desktop; verify CSP permits same-origin icons/manifest but no external scripts, and test rollback, outage, and conflict states. A source merge is not a deployment.
- Keep original Knowledge records and backups intact and Notion READ-ONLY.

Product mark source: `docs/KNOWLEDGE-APPROVED-VISUAL-BASELINE-2026-11-11.md`.
