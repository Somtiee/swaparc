import { kv } from "../../../lib/server/kv.js";
import { ethers } from "ethers";

const ARC_RPC_URL =
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC_ADDRESS = (
  process.env.PRIVPAY_USDC_ADDRESS ||
  process.env.ARCPAY_USDC_ADDRESS ||
  "0x3600000000000000000000000000000000000000"
).toLowerCase();
const TREASURY_ADDRESS = (
  process.env.PRIVPAY_TREASURY_ADDRESS ||
  process.env.ARCPAY_TREASURY_ADDRESS ||
  "0xD4d3E342902766344075D06c94391e61A9bB7e60"
).toLowerCase();
const PRICE_UNITS = ethers.parseUnits("5", 6);
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function invalid(res, code, error) {
  return res.status(code).json({ ok: false, error });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return invalid(res, 405, "Method not allowed");
  }

  try {
    const owner = String(req.body?.owner || "").trim().toLowerCase();
    const txHash = String(req.body?.txHash || "").trim();
    if (!owner || !owner.startsWith("0x")) {
      return invalid(res, 400, "Valid owner wallet required");
    }
    if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
      return invalid(res, 400, "Valid txHash required");
    }

    const replayKey = `privpay:subscription:tx:${txHash.toLowerCase()}`;
    const usedBy = await kv.get(replayKey).catch(() => null);
    if (usedBy) {
      return invalid(res, 409, "This payment transaction was already used");
    }

    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL, undefined, {
      batchMaxCount: 1,
    });
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return invalid(res, 404, "Transaction not found on RPC yet");
    }
    if (receipt.status !== 1) {
      return invalid(res, 400, "Transaction failed on-chain");
    }
    if (!receipt.to || String(receipt.to).toLowerCase() !== USDC_ADDRESS) {
      return invalid(res, 400, "Transaction is not a USDC transfer");
    }

    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]);
    const transfers = receipt.logs
      .filter(
        (l) =>
          String(l.address || "").toLowerCase() === USDC_ADDRESS &&
          Array.isArray(l.topics) &&
          l.topics[0] === TRANSFER_TOPIC
      )
      .map((l) => {
        try {
          return iface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const payment = transfers.find((evt) => {
      const from = String(evt.args?.from || "").toLowerCase();
      const to = String(evt.args?.to || "").toLowerCase();
      const value = evt.args?.value;
      return from === owner && to === TREASURY_ADDRESS && value === PRICE_UNITS;
    });
    if (!payment) {
      return invalid(
        res,
        400,
        "No matching 5 USDC transfer from this wallet to treasury was found in the transaction"
      );
    }

    const base = new Date();
    const current = await kv.get(`privpay:subscription:${owner}`).catch(() => null);
    if (current?.expiresAt && new Date(current.expiresAt).getTime() > Date.now()) {
      base.setTime(new Date(current.expiresAt).getTime());
    }
    base.setUTCMonth(base.getUTCMonth() + 1);

    const payload = {
      owner,
      plan: "monthly",
      status: "active",
      months: 1,
      txHash: txHash.toLowerCase(),
      amount: "5",
      token: "USDC",
      treasury: TREASURY_ADDRESS,
      updatedAt: new Date().toISOString(),
      expiresAt: base.toISOString(),
    };

    await kv.set(`privpay:subscription:${owner}`, payload);
    await kv.set(replayKey, owner);
    return res.status(200).json({ ok: true, subscription: payload });
  } catch (e) {
    return invalid(res, 500, e?.message || String(e));
  }
}
