# PRIVPAY Security Layer

This document defines the implemented hardening controls for PRIVPAY and an audit checklist for release readiness.

## Implemented controls

### 1) Key encryption

Server-side encryption utilities are implemented in:

- `api/security/hardening.js`

Functions:

- `encryptJson(payload)` -> AES-256-GCM envelope
- `decryptJson(envelope)` -> payload restore

Encryption key source:

- `PRIVPAY_MASTER_KEY` (preferred)
- fallback: `CIRCLE_ENTITY_SECRET` (for compatibility)

Recommendation: rotate `PRIVPAY_MASTER_KEY` regularly and store in managed secrets.

### 2) Replay protection

Replay guard is implemented in:

- `assertReplayProtected(...)` in `api/security/hardening.js`

Applied to critical execution endpoints:

- `api/circle/user/execute-contract.js`
- `api/circle/enterprise/execute-usdc-transfer.js`
- `api/circle/enterprise/execute-stealth-payment.js`

Mechanism:

- request digest hash + idempotency key + scope
- lock stored in KV with NX + TTL (memory fallback for local/dev)
- duplicate submissions return conflict-style error.

### 3) Front-running protection (execution-layer)

For stealth payment executions:

- enforce short request expiry window (`requestTimestampMs`)
- require/recommend per-request nonce (`requestNonce`)
- derive unique metadata hash from request digest when not supplied

This binds announcement metadata to a unique signed request context and reduces duplicate/malleable payload risk.

### 4) Secure randomness for stealth keys

Stealth key generation hardening in:

- `src/utils/stealthAddress.js`

Changes:

- `secureRandomScalarBytes()` uses platform CSPRNG (`crypto.getRandomValues`) with scalar range validation
- fallback to noble-secure RNG
- used by:
  - `generateStealthReceiverKeys()`
  - default ephemeral key generation in `deriveStealthPayment()`

## Audit checklist

### Secrets and key management

- [ ] `PRIVPAY_MASTER_KEY` set in production secrets manager
- [ ] key rotation policy documented
- [ ] no private keys or API secrets in git
- [ ] server logs never print raw private keys or full auth tokens

### Replay/idempotency

- [ ] all transaction-init endpoints require `requestTimestampMs`
- [ ] all transaction-init endpoints accept/use `idempotencyKey`
- [ ] duplicate request returns non-success status (no second execution)
- [ ] replay lock TTL aligns with expected retry window

### Stealth/privacy correctness

- [ ] receiver spend/view keys validated for curve/key length
- [ ] ephemeral key generated via CSPRNG
- [ ] view tag checks are case-normalized and deterministic
- [ ] metadata hash avoids leaking user PII

### Front-running resilience

- [ ] user-facing flows include pre-execution quote freshness checks
- [ ] request expiry windows enforced server-side
- [ ] contract calls avoid mutable parameters controlled by untrusted client only

### Operational hardening

- [ ] RPC fallback configured (`ARC_RPC_URL*`)
- [ ] indexer retry/backoff monitored for rate-limit errors
- [ ] alerting for repeated replay conflicts and failed challenge resolution

### Verification

- [ ] test replay: same idempotency+payload should fail second time
- [ ] test expiry: stale request timestamp should fail
- [ ] test encryption/decryption round-trip with production key
- [ ] test stealth payment execution under Circle challenge flow end-to-end

