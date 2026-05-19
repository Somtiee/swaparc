/**
 * PrivPay claim QR: encode/decode the same base64 poolClaimCode string as paste-to-claim.
 * Tuned for compressed social images and screenshots (upload decode).
 */

import QRCode from "qrcode";
import jsQR from "jsqr";
import { BrowserQRCodeReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

/** Byte-mode max for QR version 40, error correction L (~2953); leave headroom. */
export const MAX_CLAIM_QR_PAYLOAD_LEN = 2800;

const SCAN_HINTS = new Map();
SCAN_HINTS.set(DecodeHintType.TRY_HARDER, true);
SCAN_HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);

const EXPORT_QR_WIDTH = 640;
const DISPLAY_QR_WIDTH = 320;

export function canEncodeClaimInQr(code) {
  const s = String(code || "").trim();
  return s.length > 0 && s.length <= MAX_CLAIM_QR_PAYLOAD_LEN;
}

async function toDataUrlWithEc(payload, options) {
  const levels = options.preferRobustEc ? ["M", "L"] : ["L"];
  let lastErr = null;
  for (const errorCorrectionLevel of levels) {
    try {
      return await QRCode.toDataURL(payload, {
        errorCorrectionLevel,
        margin: options.margin ?? 4,
        width: options.width ?? DISPLAY_QR_WIDTH,
        color: options.color ?? { dark: "#000000", light: "#ffffff" },
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not generate QR code.");
}

export async function generateClaimQrDataUrl(code, options = {}) {
  const payload = String(code || "").trim();
  if (!canEncodeClaimInQr(payload)) return null;
  const scanOptimized = options.scanOptimized !== false;
  return toDataUrlWithEc(payload, {
    preferRobustEc: scanOptimized,
    width: options.width ?? (scanOptimized ? DISPLAY_QR_WIDTH : 256),
    margin: scanOptimized ? 4 : 2,
    color: scanOptimized
      ? { dark: "#000000", light: "#ffffff" }
      : {
          dark: options.dark ?? "#000000",
          light: options.light ?? "#ffffff",
        },
  });
}

/** Large, high-contrast QR for JPEG export (survives social compression better). */
export async function generateClaimQrDataUrlForExport(code) {
  return generateClaimQrDataUrl(code, {
    width: EXPORT_QR_WIDTH,
    scanOptimized: true,
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
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

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function preprocessImageData(imageData, { grayscale = true, contrast = 1, invert = false, threshold = null }) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (grayscale) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = y;
    }
    if (contrast !== 1) {
      r = clampByte((r - 128) * contrast + 128);
      g = clampByte((g - 128) * contrast + 128);
      b = clampByte((b - 128) * contrast + 128);
    }
    if (threshold != null) {
      const v = r >= threshold ? 255 : 0;
      r = g = b = v;
    }
    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  return imageData;
}

function tryJsQrOnCanvas(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  const text = String(result?.data || "").trim();
  return text || null;
}

function tryJsQrWithPreprocess(sourceCanvas, variant) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  preprocessImageData(imageData, variant);
  ctx.putImageData(imageData, 0, 0);
  return tryJsQrOnCanvas(canvas);
}

function isZxingImageSource(source) {
  return (
    source instanceof HTMLImageElement || source instanceof HTMLVideoElement
  );
}

async function tryZxingOnSource(reader, source) {
  if (!isZxingImageSource(source)) return null;
  const result = await reader.decodeFromImageElement(source);
  return extractQrText(result);
}

function decodeCanvasWithJsQrPipeline(canvas) {
  const direct = tryJsQrOnCanvas(canvas);
  if (direct) return direct;
  for (const variant of PREPROCESS_VARIANTS) {
    const text = tryJsQrWithPreprocess(canvas, variant);
    if (text) return text;
  }
  const side = Math.max(canvas.width, canvas.height);
  if (side < 900) {
    const up = document.createElement("canvas");
    up.width = canvas.width * 2;
    up.height = canvas.height * 2;
    const ctx = up.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, up.width, up.height);
      const upText = tryJsQrOnCanvas(up);
      if (upText) return upText;
    }
  }
  return null;
}

function buildDecodeSources(imageEl) {
  const w = imageEl.naturalWidth || imageEl.width || 0;
  const h = imageEl.naturalHeight || imageEl.height || 0;
  if (!w || !h) return [imageEl];

  const sources = [];
  const minSide = Math.min(w, h);
  const centerSize = Math.floor(minSide * 0.92);
  const cx = Math.floor((w - centerSize) / 2);
  const cy = Math.floor((h - centerSize) / 2);

  const regions = [
    { sx: 0, sy: 0, sw: w, sh: h },
    { sx: cx, sy: cy, sw: centerSize, sh: centerSize },
    { sx: 0, sy: Math.floor(h * 0.25), sw: w, sh: Math.ceil(h * 0.75) },
    {
      sx: Math.floor(w * 0.05),
      sy: Math.floor(h * 0.3),
      sw: Math.ceil(w * 0.9),
      sh: Math.ceil(h * 0.55),
    },
  ];

  const scales = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6];
  const rotations = [0, 90, 180, 270];

  for (const region of regions) {
    for (const scale of scales) {
      const sw = Math.max(1, Math.round(region.sw * scale));
      const sh = Math.max(1, Math.round(region.sh * scale));
      if (sw > 4096 || sh > 4096) continue;

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
      if (!cropCtx) continue;
      cropCtx.drawImage(
        imageEl,
        region.sx,
        region.sy,
        region.sw,
        region.sh,
        0,
        0,
        sw,
        sh
      );

      for (const deg of rotations) {
        const rotated = document.createElement("canvas");
        const rctx = rotated.getContext("2d", { willReadFrequently: true });
        if (!rctx) continue;
        if (deg === 90 || deg === 270) {
          rotated.width = sh;
          rotated.height = sw;
        } else {
          rotated.width = sw;
          rotated.height = sh;
        }
        rctx.translate(rotated.width / 2, rotated.height / 2);
        rctx.rotate((deg * Math.PI) / 180);
        rctx.drawImage(cropCanvas, -sw / 2, -sh / 2);
        sources.push(rotated);
      }
    }
  }

  sources.push(imageEl);
  return sources;
}

const PREPROCESS_VARIANTS = [
  { grayscale: true, contrast: 1, invert: false },
  { grayscale: true, contrast: 1.35, invert: false },
  { grayscale: true, contrast: 1.8, invert: false },
  { grayscale: true, contrast: 1.2, invert: true },
  { grayscale: true, contrast: 1.5, invert: true },
  { grayscale: true, contrast: 1, invert: false, threshold: 128 },
  { grayscale: true, contrast: 1, invert: false, threshold: 160 },
  { grayscale: true, contrast: 1, invert: false, threshold: 96 },
];

async function decodeFromImageElement(imageEl) {
  const reader = new BrowserQRCodeReader(SCAN_HINTS);
  const sources = buildDecodeSources(imageEl);
  let lastErr = null;

  for (const source of sources) {
    if (source instanceof HTMLCanvasElement) {
      const text = decodeCanvasWithJsQrPipeline(source);
      if (text) return text;
      continue;
    }

    try {
      const zxingText = await tryZxingOnSource(reader, source);
      if (zxingText) return zxingText;
    } catch (e) {
      lastErr = e;
    }
  }

  reader.reset?.();
  const msg = lastErr?.message || String(lastErr || "");
  if (/No MultiFormat Readers|NotFoundException/i.test(msg)) {
    throw new Error(
      "No QR code found. Try a screenshot, brighter lighting, or paste the claim code."
    );
  }
  throw new Error(
    "Could not read the claim QR. Try a screenshot of the receipt, or paste the claim code below."
  );
}

export async function decodeClaimQrFromImageFile(file) {
  if (!file) throw new Error("No image selected.");
  const img = await loadImageFromFile(file);
  return decodeFromImageElement(img);
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
