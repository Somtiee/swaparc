# Stealth Address System (ECDH)

This module implements one-time stealth addresses using secp256k1 ECDH.

## Receiver keys

Receiver owns two keypairs:

- Spend keypair:
  - `spendPrivateKey`
  - `spendPublicKey`
- View keypair:
  - `viewPrivateKey`
  - `viewPublicKey`

The receiver publishes only `spendPublicKey` and `viewPublicKey`.

## Sender flow

1. Generate ephemeral private key `r`.
2. Compute ephemeral public key `R = rG`.
3. Compute ECDH shared point with receiver view pubkey: `S = r * V`.
4. Hash shared point to scalar: `s = H(S)`.
5. Derive one-time stealth public key:
   - `P_stealth = P_spend + sG`
6. Convert `P_stealth` to `stealthAddress`.
7. Send funds to `stealthAddress`.
8. Publish announcement (`R`, `viewTag`, metadata hash) via event.

## Receiver scan flow

For each announcement:

1. Compute `S = v * R` using `viewPrivateKey = v`.
2. Derive `s = H(S)`.
3. Build expected `P_stealth = P_spend + sG`.
4. Compare expected address with announced stealth address.
5. If match, derive one-time private key:
   - `x_stealth = x_spend + s (mod n)`
6. Spend funds from stealth address.

## Files

- ECC helpers: `src/utils/stealthAddress.js`
- Announcement contract: `contracts/StealthPayments.sol`

## Important production notes

- Use AA / private bundler so transaction submission does not expose sender identity.
- Use encrypted metadata off-chain; only store ciphertext hash onchain.
- Add circuit-based shielded pools for stronger unlinkability at scale.
- Do not reuse ephemeral keys across payments.

