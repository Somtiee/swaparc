/**
 * PrivPay claim QR: encode/decode the same base64 poolClaimCode string as paste-to-claim.
 * QR capacity is limited — use canEncodeClaimInQr before showing or exporting a code matrix.
 */

import QRCode from "qrcode";
import { BrowserQRCodeReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

/** Byte-mode max for QR version 40, error correction L (~2953); leave headroom. */
export const MAX_CLAIM_QR_PAYLOAD_LEN = 2800;

const SCAN_HINTS = new Map();
SCAN_HINTS.set(DecodeHintType.TRY_HARDER, true);
SCAN_HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);

export function canEncodeClaimInQr(code) {
  const s = String(code || "").trim();
  return s.length > 0 && s.length <= MAX_CLAIM_QR_PAYLOAD_LEN;
}

export async function generateClaimQrDataUrl(code, options = {}) {
  const payload = String(code || "").trim();
  if (!canEncodeClaimInQr(payload)) return null;
  const scanOptimized = options.scanOptimized !== false;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "L",
    margin: scanOptimized ? 4 : 2,
    width: options.width ?? 256,
    color: scanOptimized
      ? { dark: "#000000", light: "#ffffff" }
      : {
          dark: options.dark ?? "#000000",
          light: options.light ?? "#ffffff",
        },
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image."));
    };
    img.src = url;
  });
}

function extractQrText(result) {
  const text = String(result?.getText?.() ?? result?.text ?? "").trim();
  if (!text) throw new Error("No QR code found in image.");
  return text;
}

function cropCanvasFromImage(imageEl, sx, sy, sw, sh, scale = 1) {
  const canvas = document.createElement("canvas");
  const maxSide = 4096;
  canvas.width = Math.min(Math.max(1, Math.round(sw * scale)), maxSide);
  canvas.height = Math.min(Math.max(1, Math.round(sh * scale)), maxSide);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imageEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildDecodeSources(imageEl) {
  const w = imageEl.naturalWidth || imageEl.width || 0;
  const h = imageEl.naturalHeight || imageEl.height || 0;
  if (!w || !h) return [imageEl];
  const sources = [];
  const regions = [
    { sx: 0, sy: 0, sw: w, sh: h },
    { sx: 0, sy: Math.floor(h * 0.3), sw: w, sh: Math.ceil(h * 0.7) },
    {
      sx: Math.floor(w * 0.1),
      sy: Math.floor(h * 0.35),
      sw: Math.ceil(w * 0.8),
      sh: Math.ceil(h * 0.5),
    },
  ];
  for (const region of regions) {
    for (const scale of [1, 2, 3, 4]) {
      const canvas = cropCanvasFromImage(
        imageEl,
        region.sx,
        region.sy,
        region.sw,
        region.sh,
        scale
      );
      if (canvas) sources.push(canvas);
    }
  }
  sources.push(imageEl);
  return sources;
}

async function decodeFromImageElement(imageEl) {
  const reader = new BrowserQRCodeReader(SCAN_HINTS);
  const sources = buildDecodeSources(imageEl);
  let lastErr = null;
  for (const source of sources) {
    try {
      const result = await reader.decodeFromImageElement(source);
      return extractQrText(result);
    } catch (e) {
      lastErr = e;
    }
  }
  reader.reset?.();
  const msg = lastErr?.message || String(lastErr || "");
  if (/No MultiFormat Readers|NotFoundException/i.test(msg)) {
    throw new Error("No QR code found in image. Use a clear photo of the receipt QR or paste the claim code.");
  }
  throw new Error("Could not read a claim QR from that image. Try better lighting, or paste the claim code.");
}

export async function decodeClaimQrFromImageFile(file) {
  if (!file) throw new Error("No image selected.");
  const img = await loadImageFromFile(file);
  return decodeFromImageElement(img);
}

export async function decodeClaimQrFromCanvas(canvas) {
  if (!canvas) throw new Error("No image frame.");
  const dataUrl = canvas.toDataURL("image/png");
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Could not read camera frame."));
    img.src = dataUrl;
  });
  return decodeFromImageElement(img);
}

/**
 * Live camera QR scanner. Call stop() when unmounting or switching modes.
 */
export function startClaimQrCameraScan({ videoEl, onResult, onError }) {
  const reader = new BrowserQRCodeReader(SCAN_HINTS);
  let stopped = false;

  const controlsPromise = reader.decodeFromVideoDevice(undefined, videoEl, (result, err) => {
    if (stopped) return;
    if (result) {
      const text = String(result.getText?.() ?? "").trim();
      if (text) onResult(text);
      return;
    }
    if (err && !/NotFoundException/i.test(String(err?.name || err?.message || err))) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return {
    async stop() {
      stopped = true;
      try {
        const controls = await controlsPromise;
        controls?.stop?.();
      } catch {
        /* ignore */
      }
      reader.reset?.();
    },
  };
}

export function downloadDataUrl(filename, dataUrl) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  try {
    downloadDataUrl(filename, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
