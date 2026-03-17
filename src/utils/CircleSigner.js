
import { ethers } from "ethers";

/**
 * Custom Ethers.js Signer for Circle User-Controlled Wallets
 * Implements the minimal interface required for contract interactions.
 */
export class CircleSigner extends ethers.AbstractSigner {
  /**
   * @param {string} walletId - The Circle Wallet ID
   * @param {object} sdk - The initialized Circle W3S SDK instance
   * @param {ethers.Provider} provider - A read-only provider (e.g. JsonRpcProvider)
   */
  constructor(walletId, sdk, provider) {
    super(provider);
    this.walletId = walletId;
    this.sdk = sdk;
    // We don't store userToken/encryptionKey here permanently to avoid staleness,
    // we fetch them from storage when needed.
  }

  /**
   * Connects the signer to a provider.
   */
  connect(provider) {
    return new CircleSigner(this.walletId, this.sdk, provider);
  }

  /**
   * Returns the wallet address.
   */
  async getAddress() {
    // In a real implementation, we might want to fetch this from the API if not known,
    // but for now we assume the app passes the correct walletId corresponding to an address.
    // However, AbstractSigner expects getAddress to be async.
    // We can't easily get the address from walletId without an API call if it wasn't passed in.
    // To make this robust, we might need to pass address in constructor or fetch it.
    // Let's assume the App passes it or we fetch it.
    // For now, let's rely on the App to pass the address or store it.
    // Actually, the App's `getSigner` implementation used `circleWallet.address`.
    // Let's update the constructor to take address too.
    if (this._address) return this._address;
    throw new Error("CircleSigner: Address not provided during initialization");
  }

  setAddress(address) {
    this._address = address;
  }

  /**
   * Signs a transaction.
   * Circle Wallets (User-Controlled) do not support offline signing of raw transactions
   * in the same way EOA wallets do. They execute challenges.
   * So we throw here, as we should use sendTransaction directly.
   */
  async signTransaction(tx) {
    throw new Error("CircleSigner: signTransaction is not supported. Use sendTransaction.");
  }

  /**
   * Signs a message.
   */
  async signMessage(message) {
    throw new Error("CircleSigner: signMessage is not yet implemented.");
  }

  /**
   * Signs typed data.
   */
  async signTypedData(domain, types, value) {
    throw new Error("CircleSigner: signTypedData is not yet implemented.");
  }

  /**
   * Sends a transaction.
   * 1. Calls backend to initiate contract execution -> gets challengeId
   * 2. Calls SDK to execute challenge
   * 3. Polls for transaction hash
   * 4. Returns a TransactionResponse-like object
   */
  async sendTransaction(tx) {
    console.log("[CircleSigner] Sending transaction...", tx);

    // 1. Validate Transaction
    const txRequest = await this.populateTransaction(tx);
    if (!txRequest.to || !txRequest.data) {
      throw new Error("CircleSigner: Transaction must have 'to' and 'data'");
    }

    const to =
      typeof txRequest.to === "string" ? txRequest.to : String(txRequest.to);
    let dataHex = txRequest.data;
    if (typeof dataHex !== "string") {
      try {
        dataHex = ethers.hexlify(dataHex);
      } catch {
        throw new Error("CircleSigner: Transaction data must be hex string");
      }
    }

    // 2. Retrieve Auth Tokens
    const userToken = window.localStorage.getItem("circle_user_token");
    const encryptionKey = window.localStorage.getItem("circle_encryption_key");

    if (!userToken || !encryptionKey) {
      throw new Error("CircleSigner: Missing authentication tokens. Please log in again.");
    }

    // 3. Initiate Transaction on Backend
    // We need to pass the raw value if present (hex string or bigint)
    // Note: CircleSigner is an ethers Signer used when interacting with contracts natively.
    // However, since Circle User-Controlled Wallets require abiFunctionSignature and abiParameters,
    // and Ethers passes us raw encoded hex data via `txRequest.data`, we cannot easily reverse-engineer
    // the ABI parameters without the ABI itself.
    // Because App.jsx now bypasses CircleSigner for direct contract calls and uses `executeCircleContractAction`,
    // CircleSigner is currently unused by the main application flow that we are fixing.
    // We will throw an error here to prevent accidental use with raw calldata that would fail at the API.
    throw new Error(
      "CircleSigner: sendTransaction via ethers is unsupported for Circle Wallets due to ABI parameter requirements. Use executeCircleContractAction instead."
    );

    // 4. Execute Challenge via SDK
    // Ensure fresh authentication
    this.sdk.setAuthentication({ userToken, encryptionKey });

    const challengeResult = await new Promise((resolve, reject) => {
      this.sdk.execute(challengeId, (error, result) => {
        if (error) {
          console.error("[CircleSigner] SDK Execute Error:", error);
          if (error.code === 155706) {
             reject(new Error("Network Error (155706): Please disable ad-blockers or use Incognito mode."));
          } else {
             reject(error);
          }
          return;
        }
        resolve(result);
      });
    });

    console.log("[CircleSigner] SDK Execution Complete:", challengeResult);

    // 5. Poll for Transaction Hash
    // The SDK result might contain txHash, but it's often null initially.
    // We must poll the backend or Circle API until we get a valid hash.
    const txHash = await this._waitForTxHash(challengeId);

    if (!txHash) {
      throw new Error("CircleSigner: Failed to retrieve transaction hash.");
    }

    // 6. Return TransactionResponse
    // We construct a mock response that mimics ethers.TransactionResponse
    // but uses our own wait logic (or relies on provider).
    // Since we have a valid hash, we can use the provider to get the real transaction,
    // but it might not be indexed immediately.
    
    return new ethers.TransactionResponse({
      hash: txHash,
      provider: this.provider,
      confirmations: 0,
      from: this._address,
      to: txRequest.to,
      nonce: 0, // We don't know the nonce easily without querying
      gasLimit: BigInt(0), // Unknown
      gasPrice: BigInt(0), // Unknown
      data: txRequest.data,
      value: BigInt(valueStr),
      chainId: BigInt(5042002) // Arc Testnet
    }, this.provider);
  }

  /**
   * Polls the backend for the challenge status to retrieve the transaction hash.
   */
  async _waitForTxHash(challengeId) {
    let attempts = 0;
    const maxAttempts = 45; // 90 seconds (2s interval)

    const userToken = window.localStorage.getItem("circle_user_token");

    while (attempts < maxAttempts) {
      try {
        const res = await fetch(`/api/circle/user/challenge-status?challengeId=${challengeId}`, {
          headers: {
            "X-User-Token": userToken
          }
        });
        if (res.ok) {
          const data = await res.json();
          // New backend returns { challenge, transactionHash }
          if (data?.transactionHash && data.transactionHash.startsWith("0x")) {
            console.log("[CircleSigner] Retrieved Hash:", data.transactionHash);
            return data.transactionHash;
          }
          const challenge = data?.challenge ?? data;
          const hash =
            challenge?.transactionHash ||
            challenge?.txHash ||
            challenge?.transaction?.transactionHash ||
            challenge?.transaction?.txHash;
          if (hash && hash.startsWith("0x")) {
            console.log("[CircleSigner] Retrieved Hash:", hash);
            return hash;
          }
        }
      } catch (e) {
        console.warn("[CircleSigner] Status poll failed:", e);
      }

      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }
    return null;
  }
}
