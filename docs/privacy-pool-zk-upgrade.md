# ZK privacy pool (current stack)

The app targets **ZKPrivacyPool** only: Poseidon note commitments, Merkle roots on-chain, and **Groth16** verification via **PrivPayGroth16Verifier**. Claims call **`withdraw(bytes,bytes32,address,uint256)`** — the proof blob is `abi.encode(pA, pB, pC, publicSignals[5])`; the explicit **`nullifierHash`**, **`recipient`**, and **`amount`** must match the proof’s public signals. **`commitmentAmount[commitment]`** records the amount at **`deposit(bytes32,uint256)`**; withdrawals cannot exceed that cap for the note leaf inside the proof.

- **Deploy:** `npm run deploy:pool` — compiles `ZKPrivacyPool.sol` + `PrivPayGroth16Verifier.sol`, reads **`PRIVPAY_VERIFICATION_KEY_JSON`** (snarkjs `verification_key.json` from your final zkey).
- **Frontend:** set **`VITE_PRIVACY_POOL_ADDRESS`** to the deployed pool; optional **`VITE_PRIVPAY_WASM_URL`** / **`VITE_PRIVPAY_ZKEY_URL`** for in-browser proving; optional **`VITE_PRIVACY_POOL_USE_RELAY`** for **`/api/privpay/privacy-pool-relay`** (`action`: **`deposit`** via on-chain **`depositFor`**, **`withdraw`**), with server **`PRIVACY_POOL_ADDRESS`** allowlist, per-IP rate limit, and **PrivPayPoolRelay** EIP-712 signatures (no proof bodies in logs).
- **Receipt exports:** may include **`zk-meta`** base64 JSON (commitment, optional root/leaf index) for payroll/history — **no secrets**; withdrawal still requires a saved encrypted note or backup on the recipient device.

On-chain Merkle updates use **Poseidon(2)** (via `PoseidonT3.sol`), matching the **circuits** and the **JS mirror** (`privacyPoolPoseidonMerkle.mjs`). `bytes32` roots in `RootUpdated` are directly provable against `privpay_claim.circom`.

Legacy preimage pools, mock verifiers, and `withdrawWithProof`-style paths are not part of this codebase.
