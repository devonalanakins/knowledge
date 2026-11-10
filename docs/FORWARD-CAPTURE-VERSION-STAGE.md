# Knowledge capture: version-only staging (NOT active)

**Release state:** operator-command source only. Cloudflare's currently deployed
Knowledge owner and capture Workers must not be overwritten by an incomplete
Wrangler config. This procedure never permits public routing, scheduled event
drain, secrets installation, named RPC activation, GitHub Actions delivery, or
Notion migration.

## Why this is a separate stage

The two nonpublic capture Workers already exist with one pinned, isolated D1
binding apiece. The current source-only manifests reproduce only the reviewed
disabled baseline. A Worker **version upload** is distinct from a **version
deployment**: it stages code for later review without changing the version
serving requests. Cloudflare documents `wrangler versions upload` for staging,
and `wrangler rollback` / version deployments for separately authorized traffic
changes. Source: https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/

## Exact manual gate (owner private environment only)

1. Confirm canonical protected `main`, completed Node 22/24/G24 checks,
   clean full diff, and passing nonuploading three-bundle Wrangler CI.
2. Independently read actual Cloudflare Worker settings, disabled
   workers.dev/preview, compatibility date, D1 isolation, empty Cron,
   and single 100% active rollback version. Confirm recovery of production
   owner Knowledge data is separately verified. Never substitute fictional
   acceptance data for this gate.
3. Use an owner-scoped Cloudflare credential with the minimum required
   Worker read/upload permissions held **outside** source, chat, and CI.
   No credential is provided by this repository.
4. Set private environment variables:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - `KNOWLEDGE_CAPTURE_VERSION_STAGE_ACK=OWNER_APPROVED_NONPUBLIC_CAPTURE_VERSION_UPLOAD_V1`
   - `KNOWLEDGE_CAPTURE_EXPECTED_ACTIVE_VERSION` = exact independently
     observed version ID of **the selected Worker**
5. Execute **one component** through
   `npm run capture:stage-version -- ingress` or
   `npm run capture:stage-version -- processor`.
   Do **not** use the owner RPC compile-only manifest; that one has a
   different name and no live configuration.
6. The command performs the existing read-only eight-GET staging guard,
   rejects changed configuration and rollback baseline, executes exactly
   `wrangler versions upload --keep-vars --strict --config <selected manifest>`
   using pinned Wrangler 4.68.0, and re-runs the eight-GET guard.
   The wrapper does not emit Wrangler logs, tokens, secret values, D1 rows,
   or private page content. It prints only generic status and Worker name.
7. Independently verify Cloudflare's newly uploaded version **exists**, inspect
   that version's settings/bindings, retain its version ID, and confirm the
   active deployment remains at the preupload rollback version. The local
   result `UPLOAD_COMMAND_SUCCEEDED_ACTIVE_UNCHANGED` represents the CLI's successful
   exit and unchanged active metadata, **not** independent proof that a
   version was created or that secrets were preserved within it.

## Failure/rollback boundaries

- Missing explicit approval, a wrong immutable baseline version, altered
  D1 ID, changed public state, added bindings/permissions, nonempty Cron,
  version split, unavailable provider metadata, or upload failure aborts.
- A failed postupload inspection is **not** safe to treat as a successful
  release; inspect the remote state before any retry. An uploaded version
  alone should carry zero production traffic. Never blindly re-run uploads
  after an ambiguous transport failure.
- This CLI deliberately does **not** deploy the staged version or invoke
  `wrangler rollback`. Rollback of a traffic deployment requires a separate
  explicitly authorized action and confirmed previous version.
- `--keep-vars` avoids deleting dashboard-managed vars. `--strict` asks
  Wrangler to reject conflicting remote settings. Both flags are defensive,
  not a substitute for observing **all** exact bindings and restored behavior
  on an independently validated version.

## Still required for LIVE automatic Knowledge capture

Separately review machine key custody, canonical personal/nonclinical repo
mapping, protected GitHub merge-source delivery, owner Worker named RPC
version, service binding and correct Access behavior. Gate public HMAC ingress
by verified source plus rate limits, release processor Cron with independent
retries, and accept at least one real non-sensitive merged PR with inbox
acknowledgment and exact authenticated Knowledge readback, deduplication and
safe rollback. None of these activation steps are performed here.

Keep Notion read-only and all clinical/client/private-family data outside
this capture scope.
