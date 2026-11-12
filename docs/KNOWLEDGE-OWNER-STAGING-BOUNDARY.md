# Knowledge — isolated owner UI staging boundary

**Status:** Source-only, read-only staging topology guard. No hosted staging environment has been created or authorized by this document.

## Observed provider state — 2026-11-11

Read-only Cloudflare inventory found one Knowledge owner Access application, one production owner Worker, and one production forward-record D1. There is **no identified dedicated Knowledge owner UI staging Worker, Access application, or staging D1**. Other Knowledge-related databases are for historical restore/capture workflows; **do not repurpose them**.

The production owner Worker is `knowledge-forward-private`. The staging identity is deliberately reserved internally as `knowledge-owner-ui-stage`; that name does **not** establish a deployed resource or public service.

## Safe stage topology contract

A future stage must meet all of these conditions **before any Worker upload or routing**:

1. A **new, dedicated D1** named `knowledge-owner-ui-stage`, never the production owner D1, capture-inbox, restored snapshot, or any private/clinical database. Seed only explicitly fictional test data.
2. A **separate** Cloudflare Access application for the stage's exact hostname, with an owner-approved identity policy verified independently. An Access application name/hostname match alone does not prove the policy is secure. Check direct owner identity, no anonymous bypass, and MFA requirements.
3. A **distinct Worker script** `knowledge-owner-ui-stage`, with no production route aliases and no shared production database.
4. Staging binds only the ten approved keys in `src/forward-owner-ui-staging-guard.mjs`: dedicated `KNOWLEDGE_DB`, an independent encryption key/ID, owner Access audience/email, resource, scope and browser acknowledgement, and **fictional-only acceptance acknowledgement**.
5. Staging must **not** have `KNOWLEDGE_PRIVATE_WRITE_ACK`, `KNOWLEDGE_OWNER_EDITOR_ACK`, public-sharing, capture-machine, or other unreviewed bindings. The Worker code explicitly forbids simultaneous fictional-only and unrestricted write modes.
6. Keep `workers_dev`, preview URL and routing settings aligned with a separately reviewed, protected entry point. A public-facing staging URL must not exist **before** an enforcing Access policy. Verify routing from the edge; the guard checks *metadata separation only*.
7. Before any owner device test, verify the active Worker version and source-to-deployment attestation, Access policy including actual enforced identity, D1 synthetic-only contents, private secrets isolation, and an independent rollback to the previous known-good stage version.
8. Never use production session cookies, production data keys, historic Notion exports or clinical/client data in staging.

## Read-only diagnostic

```bash
KNOWLEDGE_UI_STAGE_GUARD_ACK=READ_ONLY_STAGING_REVIEW_V1 \
  CLOUDFLARE_ACCOUNT_ID='<account id>' \
  CLOUDFLARE_API_TOKEN='<read-only API token injected securely>' \
  KNOWLEDGE_PRODUCTION_ORIGIN='https://<verified production host>' \
  KNOWLEDGE_STAGING_ORIGIN='https://<proposed or verified staging host>' \
  node ops/private-forward/guard-owner-ui-staging.mjs
```

Do not paste actual API tokens, session cookies, D1 identifiers, or keys into chat, PRs, command history, or CI logs. The tool reads Cloudflare metadata only, using four **GET** requests. It never uploads Workers, modifies policies, accesses D1 rows, or reads secret binding values. It now performs **four inventory GETs plus up to two Access-policy GETs** (six total when both Access apps exist). If either policy request is forbidden, missing, or incomplete, the check fails closed.

The report emits **reason codes only** and always sets `deploymentAuthorized:false`, `accessPolicyVerified:false`, `secretValuesVerified:false`, `syntheticDataVerified:false`, `hostedOwnerFlowVerified:false` and `rollbackVerified:false`.

The read-only policy check accepts exactly one `allow` rule with one lowercase explicit email selector and no additional include/require/exclude selectors for **both** production and staging. The addresses must match, but are **never included in the report**. `accessPolicyMetadataMatch:true` means only that the provider's returned policy metadata matches this narrow rule. It does **not** establish that the edge enforces the policy, MFA is configured, the owner is authenticated, or a production session is safe to reuse.

- `BLOCKED`: missing or conflicting stage worker, database, Access application, binding isolation, origin, or inventory. Exit 2.
- `STAGING_METADATA_SEPARATED`: necessary metadata separation observed; **not** permission to deploy, not proof that Access is enforceable, not a clinical/privacy compliance assessment. Exit 0.
- `KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE`: incomplete provider read, malformed settings, token/access failure or unsafe invocation. Exit 1.

## Actual release acceptance still required

Run the existing `knowledge:release:preflight` against the real, protected stage using only fictional records. Independently test mobile/desktop browser rendering, the **locked neural-K mark**, keyboard and focus, iPhone Home Screen appearance, owner-only Markdown round-trip, request-denial cases, ciphertext integrity, real cloud routing, rollback and monitoring. Production remains unchanged until those checks and explicit owner release approval.

Notion stays read-only, historical migration remains NO-GO, and public-sharing PRs remain separate.
