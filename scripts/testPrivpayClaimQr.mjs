/**
 * Node tests for PrivPay claim QR decode (run before shipping camera/upload changes).
 * Usage: node scripts/testPrivpayClaimQr.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourcePath = join(root, "src/utils/privpayClaimQr.js");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("ok:", msg);
}

function jsQrFromPng(png) {
  const data = new Uint8ClampedArray(png.data);
  return jsQR(data, png.width, png.height, { inversionAttempts: "attemptBoth" });
}

function resizePng(png, newW, newH) {
  const out = new PNG({ width: newW, height: newH });
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const sx = Math.floor((x / newW) * png.width);
      const sy = Math.floor((y / newH) * png.height);
      const si = (sy * png.width + sx) << 2;
      const di = (y * newW + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

async function testSharpQrRoundtrip() {
  const payload =
    "eyJ0ZXN0IjoidmVyaWZ5LWNsYWltLXFyLXNjYW4ifQ"; // base64-ish sample
  const buf = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 640,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const png = PNG.sync.read(buf);
  const result = jsQrFromPng(png);
  if (!result?.data || result.data !== payload) {
    fail(`jsQR roundtrip expected "${payload}", got "${result?.data}"`);
  }
  ok("jsQR decodes 640px export-style QR");
}

async function testCompressedQr() {
  const payload = "compressed-receipt-qr-test-v1";
  const buf = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 640,
  });
  let png = PNG.sync.read(buf);
  png = resizePng(png, Math.floor(png.width / 3), Math.floor(png.height / 3));
  png = resizePng(png, 640, 640);
  const result = jsQrFromPng(png);
  if (!result?.data || result.data !== payload) {
    fail("jsQR should decode downscaled-then-upscaled QR (social compression sim)");
  }
  ok("jsQR decodes compressed/resized QR");
}

function testCameraSourceNoZxingOnCanvas() {
  const src = readFileSync(sourcePath, "utf8");
  const cameraBlock = src.slice(
    src.indexOf("export function startClaimQrCameraScan"),
    src.indexOf("export function downloadDataUrl")
  );
  if (/decodeFromImageElement\s*\(\s*scanCanvas/.test(cameraBlock)) {
    fail("camera scanner must not pass canvas to ZXing decodeFromImageElement");
  }
  if (!/decodeVideoFrameForClaimQr/.test(cameraBlock)) {
    fail("camera scanner should use decodeVideoFrameForClaimQr");
  }
  if (/zxingReader/.test(cameraBlock)) {
    fail("camera scanner should not use zxingReader in live loop");
  }
  ok("camera scan path is jsQR-only (no canvas ZXing)");
}

async function main() {
  await testSharpQrRoundtrip();
  await testCompressedQr();
  testCameraSourceNoZxingOnCanvas();
  console.log("\nAll claim QR tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
