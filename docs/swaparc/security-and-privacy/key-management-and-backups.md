# Key management & backups

This page lists **what must be protected**, how **individual users** and **teams** should handle material, and how **recovery** and **Circle** flows fit into routine operations. It sits under **Developers & operators** → **Security & operations**. Read it with [Security overview](security.md) for custody context, [Threat model](threat-model.md) for trust boundaries, [ZK claim security](zk-claim-security.md) for claim/logging discipline and [Prerequisites & environment](../getting-started/prerequisites-and-environment.md) for where secrets appear in `.env`.

## What must be protected

**Wallet private keys or wallet session authority** gate every on-chain action in standard-wallet mode; loss or sharing equals loss of funds or signing capability. **PrivPay claim material and note-related backup data** are what let a holder complete or recover a private receive path; anyone with copies can race you to a valid claim if they can also satisfy on-chain checks. **Circle auth/session artifacts used by application flows** bind email-wallet sessions to your deployment and must not leak into logs or support dumps. The **Relayer private key on backend systems** is high impact at small size: it can spend gas and submit relay-scoped transactions, so treat it like production treasury access and not a developer convenience string.

## User-level guidance

**Keep claim codes and note exports private.** **Store backups in an encrypted password manager or secure vault.** **Avoid sharing claim material in chat channels or tickets.** In practice that means screenshots, Slack threads and “can you paste your note here?” requests are all out of scope for real secrets; if support needs to debug, use redacted metadata and reproduce on a throwaway test wallet when possible.

## Team-level guidance

Separate environments so a mistake in **development** never becomes a leak in **production**: different RPC keys where billing matters, different relayer EOAs and different Circle app IDs or server keys when your provider allows it. Never copy a production `.env` into a shared laptop “just to test.”

- Restrict access to production `.env` values.
- Rotate relayer and API secrets on a fixed schedule.
- Use separate keys for development, staging and production.

Pair the third bullet with **config management** your org already uses (sealed secrets, KMS references or CI-injected vars) so “which key is live” is answerable from a dashboard, not from whoever last edited a file.

## Recovery practice

Rehearsal beats improvisation: operators should prove they can restore from backups **before** users depend on a new flow.

- Test backup and recovery flows in staging before production rollout.
- Document recovery ownership and escalation path.
- Keep a runbook for compromised key response.

The runbook should name **who** pauses relaying, **who** rotates keys, **who** talks to users and **which** dashboards confirm traffic has dropped to safe levels—during an incident is not the time to decide that.

## Circle-specific notes

Circle-backed flows add **email and device** surfaces on top of chain keys; mis-handling them is equivalent to mis-handling wallet exports for many users.

- Ensure Circle credentials are scoped and rotated.
- Treat device and challenge workflow outputs as sensitive operational data.
- Verify challenge completion logic before high-volume releases.

Treat **staging** as the place to run automated UI tests against real Circle sandbox behavior; production should not be the first time you learn a challenge step times out under load.
