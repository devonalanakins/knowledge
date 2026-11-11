# Knowledge — approved product visual baseline (2026-11-11)

**Decision:** owner approved the last connected-workspace concept as the implementation reference, with iterative refinement until the application matches its information hierarchy, density, navigation, spacing and visual character. Implement in the existing `devonalanakins/knowledge` codebase; no replacement app, duplicate UI or reinterpretation of the direction.

## Canonical image
- Image from the 2026-11-11 Knowledge conversation: `knowledge_connected_workspace_ui_concept.png`
- Raster dimensions: **1672 × 941 pixels**
- SHA-256 of exact approved PNG: `f1ae517e7ceda2be08a51222e81062ace82fa3b59f8b697c9a6bfeabbea480b7`
- The binary is retained as the approved conversation artifact; this source-only PR does **not** add that PNG to Git or imply it can be retrieved from the repository. Future visual QA must explicitly compare against the named, hash-pinned reference, not generated substitute art.
- Supersedes older branded `DevonStation Knowledge` triangles, unrelated neural-tree hero graphics, and roomy card dashboards.

## Identity — LOCKED
- Product name **Knowledge** independently, never `DevonStation Knowledge` in the masthead. Product owner/developer identity, organization workspace identity, and access scope are separate fields and security concepts.
- The approved **neural branching K** has a strong central trunk, three directional branches, and three terminal nodes. Its small symbol stays distinct from DevonStation and from the separate Nona Neuropsychology neural-tree identity.
- Neutral `Private workspace` is accurate for the current owner-only forward service. Do **not** invent `Akins Works`, `Devon Works`, `Nona` or any company as the authorized workspace until backed by actual identity and scope. Do not create workspace-switcher dropdown behavior without backend grants.
- Visual palette: deep graphite/green-blue surfaces, luminous mint-teal highlights, restrained warm secondary accents, crisp humanist sans-serif typography. Use no ornamental shield, fake encryption certification, gradients that harm text readability, or pixelated raster logos.
- Security and resilience are earned by access, audit, key custody, recovery testing and data minimization; the symbol alone must not claim compliance or zero-risk operation.

## Locked UI composition
1. **Desktop**: ~60px product header with mark, authorized workspace indicator, search affordance, truthful private/editor state. Below: compact left navigation rail; middle dense record register; primary Markdown document reader; narrower contextual details/history inspector. No oversized hero, deck, dashboard tile grid, or decorative fake metrics.
2. **Phone**: one focused pane at a time (browse → selected record → back), accessible bottom navigation to real Home/Browse/Search, safe area spacing, ≥44px major touch targets. Retain current paging cursor when returning from a selected record.
3. **Private records**: real title, path, version, edited timestamp when known, owner-only badge and encrypted-body rendering; immutable history, bounded search and CAS editor. No invented review/approval states. Optional private disclosure preview is clearly not a public share.
4. **Authorized actions only**: every visible action must route to an existing working operation. Real `/wiki`, `/wiki/explore`, `/wiki-find`, `/wiki/page/...`, `/wiki/history/...`, and editor/preview only when server-side enabled. No live public share, named-user invite, file upload, collection builder, automation or storage meter yet.
5. **Source integrity and accessibility**: no third-party assets or scripts, no client side secrets, all source content escaped, strong CSP, semantic headings/navigation, visible focus and keyboard reachability, reduced motion. Cross-workspace isolation is server-enforced; portal labels alone do not authorize discovery.

## Execution and acceptance
- This initial increment is the independent brand and responsive private application shell, not a production launch.
- Tests must verify small icon SVG and wordmark, no legacy umbrella label, no unapproved workspace name, truthful nav actions, CSP and safe Markdown, owner-only routes, private editor no-form conflict state, mobile breakpoints, and reduced-motion stylesheet.
- Actual browser screenshots at 320, 390, 768, 1440 and wide desktop must be compared region by region against the approved PNG with **MATCH / INTENTIONAL CHANGE / GAP** and accessibility/overflow checks. A successful source unit test is not visual acceptance.
- No Cloudflare deployment, data conversion, migration, public-link sharing or Notion disconnection is authorized merely by implementing this design. Production deployment requires its independent approval and observed rollback/owner session checks.
- Important phased completion sequence remains **private app first, Notion archive parity + independent restore, formal retirement, Drive-class files, invitation/sharing collaboration**, without losing the complete long-term files scope.

**Status after this change:** OWNER APPROVED visual direction; UI source increment in active PR; real mobile/desktop visual review and live release still pending.
