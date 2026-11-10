# Capture credentials — owner-local encrypted recovery (no online activation)

**Status:** Implemented as source-only owner utility. This document does not
authorize public ingress, Actions activation, processor scheduling, or changing
production Worker secret bindings. Current automatic capture is **OFF**.

## Why this exists

The reviewed capture pipeline requires two independent 256-bit keys, which
must not be reused from the existing owner Knowledge encryption root:

1. `CAPTURE_INBOX_ROOT_HEX`: AES-256-GCM encrypted receipt inbox, same value
   bound to the **ingress** and **processor** Workers.
2. `CAPTURE_MACHINE_AUTH_KEY_HEX` (processor) /
   `KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX` (owner): independent HMAC identity
   key for the **private processor → named owner RPC** connection.

GitHub merge delivery now preferably uses GitHub Actions `github_oidc_v1`
short-lived RS256 identity, so it does **not** require a persistent
`KNOWLEDGE_CAPTURE_SIGNING_SECRET` in Actions or a
`CAPTURE_WEBHOOK_SECRET` in the ingress. The legacy HMAC mode exists
only as a separately reviewed alternative.

Cloudflare Worker secret storage does not provide owner-readable recovery
values. If the only copy of the inbox root key is lost, existing encrypted
receipts may become unrecoverable. The recovery kit must exist **before**
installing keys or permitting any real receipt into the inbox.

## Trusted owner device only

Run these commands on the owner's local interactive computer with Node 22+.
**Never** run in ChatGPT/agent execution, a hosted CI runner, screen-recorded
shell, or remotely shared terminal. Choose a trusted private folder outside
the Git repository, cloud synchronization, logs, or temporary directories.

```sh
npm run knowledge:key:capture -- create /private/owner-vault/knowledge-capture-recovery.json inbox-v1
npm run knowledge:key:capture -- verify /private/owner-vault/knowledge-capture-recovery.json
```

The `create` command prompts twice for a long independent passphrase without
echoing it, generates two independent random keys, writes **only an encrypted
JSON recovery kit** with exclusive create and POSIX 0600 permissions where
supported, then verifies decryptability immediately. It prints only a
key identifier and short independent SHA-256 fingerprint prefixes.

Store a protected copy of the encrypted kit and the passphrase in **separate**
owner-controlled recovery locations. Independently repeat `verify` after
copying the kit. Do not rely solely on an ephemeral development environment,
the Cloudflare settings page, or a chat transcript for recovery.

Only when explicitly installing the secrets from the trusted local terminal:

```sh
npm run knowledge:key:capture -- reveal /private/owner-vault/knowledge-capture-recovery.json --show-keys
```

This command deliberately prints the secret values **only with the explicit
`--show-keys` flag and an interactive owner terminal**. Do not paste its
output into ChatGPT, a command transcript, GitHub, a PR or screenshots.
Transfer the values directly into the approved private Cloudflare secret
bindings on the correct Workers.

| Secret | Worker scope |
| --- | --- |
| `CAPTURE_INBOX_ROOT_HEX` | Dedicated ingress and processor only |
| `CAPTURE_MACHINE_AUTH_KEY_HEX` | Processor only |
| `KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX` | Existing owner Worker only |
| `CAPTURE_INBOX_KEY_ID` | Same benign `inbox-v1` identifier on ingress/processor |

The corresponding ACKs, repository allowlist, URL, processing schedule and
GitHub Actions enablement are **separate** activation decisions. Do not
install machine keys in the public-facing ingress, give the processor the
owner's data key, or grant GitHub Actions a Cloudflare/Knowledge root key.

## Release gates after local recovery succeeds

1. Verify owner Knowledge encrypted backup, independent read-only recovery
   and the previous deployed Worker versions. A backup bucket inventory
   alone is **not** an offline restore test.
2. Verify the recoverable kit on a distinct trusted device or recovery
   session and record fingerprints **without secret values**. Source-only
   fictional tests cannot certify production custody.
3. Review isolated D1 identity, owner Access, named service binding and
   narrow repository ID/pathPrefix scope. Stage any binding change and
   verify before promoting; a Cloudflare binding update can affect the
   active script configuration.
4. Configure the exact OIDC mode on ingress and GitHub Actions, retaining
   the deliberate **off** state until the signed `/github` route, ingress
   URL, and repository variables have independent owner approval.
5. After verification, authorize the bounded five-minute processor schedule
   and one protected-main nonclinical PR merge; confirm one authenticated
   receipt, encrypted inbox state `saved`, exact owner Knowledge readback,
   duplicate denial, no owner Access bypass, and documented rollback.

If a key or passphrase is lost **before** activation, do not silently
regenerate a different key under the same key ID. If a key is lost **after**
capture begins, freeze new delivery, preserve encrypted receipts and review
rotation/re-encryption with key-version inventory before any replacement.
Never delete the prior kit while older encrypted data might depend on it.

## Synthetic verification

Run `node --test test/forward-capture-credential-recovery.test.mjs` in
development. Tests only generate fictional ephemeral credentials and validate
wrong-passphrase/tampered-data rejection, symlink denial, immutable kit
creation, no plaintext in sealed JSON and refusal to run CLI reveal/create
without a trusted interactive terminal. CI does **not** generate or
reveal production keys and does not modify Cloudflare or GitHub.
