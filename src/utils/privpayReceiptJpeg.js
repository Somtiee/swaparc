/**
 * PrivPay receipt JPEG export — captures the same DOM/CSS as the in-app Receipt modal.
 */

import { canEncodeClaimInQr, generateClaimQrDataUrl } from "./privpayClaimQr.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== "") node.textContent = text;
  return node;
}

function addReceiptField(grid, label, value, { asCode = false } = {}) {
  const field = el("div", "receiptField");
  field.appendChild(el("span", null, label));
  if (asCode) {
    field.appendChild(el("code", null, value || "Not available"));
  } else {
    field.appendChild(el("strong", null, value || "—"));
  }
  grid.appendChild(field);
}

function buildReceiptExportElement(receipt, qrDataUrl) {
  const root = el("div", "receiptModal receiptModalExport");
  root.setAttribute("aria-hidden", "true");

  root.appendChild(el("div", "receiptGlow"));

  const header = el("div", "receiptHeader");
  const headerLeft = el("div");
  headerLeft.appendChild(el("h3", "receiptTitle", "Receipt"));
  headerLeft.appendChild(
    el(
      "p",
      "receiptSub",
      receipt.kind === "payroll" ? "Payroll payout" : "Bill payment"
    )
  );
  if (receipt.showClaimed || receipt.showResolved) {
    const pills = el("div", "receiptStatusPills");
    if (receipt.showClaimed) {
      pills.appendChild(el("span", "claimedPill", "Claimed"));
    }
    if (receipt.showResolved) {
      pills.appendChild(el("span", "resolvedPill", "Resolved"));
    }
    headerLeft.appendChild(pills);
  }
  header.appendChild(headerLeft);
  header.appendChild(el("span", "receiptPill", receipt.typeLabel || "Receipt"));
  root.appendChild(header);

  const grid = el("div", "receiptGrid");
  addReceiptField(grid, "Bill / Salary item", receipt.title);
  addReceiptField(grid, "Amount", receipt.amountLabel);
  addReceiptField(grid, "Receiver address", receipt.receiverAddress, { asCode: true });
  addReceiptField(
    grid,
    "Date paid",
    receipt.paidAt ? new Date(receipt.paidAt).toLocaleString() : "Pending"
  );
  addReceiptField(
    grid,
    "Next due",
    receipt.nextDueAt ? new Date(receipt.nextDueAt).toLocaleString() : "—"
  );
  if (receipt.companyName) {
    addReceiptField(grid, "Company", receipt.companyName);
  }
  root.appendChild(grid);

  const claimWrap = el("div", "receiptClaimWrap");
  const claimHead = el("div", "receiptClaimHead");
  claimHead.appendChild(el("span", null, "Claim code (recipient)"));
  claimWrap.appendChild(claimHead);

  const claimCode = String(receipt.claimCode || "").trim();
  const codeArea = el("textarea", "receiptClaimCode");
  codeArea.readOnly = true;
  codeArea.rows = 3;
  codeArea.value = claimCode || "No claim code for this rail.";
  claimWrap.appendChild(codeArea);

  if (claimCode && qrDataUrl) {
    const qrPanel = el("div", "receiptQrPanel");
    qrPanel.appendChild(
      el(
        "p",
        "receiptQrCaption",
        "Scan to claim (same as code above). QR is as sensitive as the claim code."
      )
    );
    const img = document.createElement("img");
    img.className = "receiptQrImage";
    img.alt = "Claim QR code";
    img.width = 240;
    img.height = 240;
    img.src = qrDataUrl;
    qrPanel.appendChild(img);
    claimWrap.appendChild(qrPanel);
  } else if (claimCode && !canEncodeClaimInQr(claimCode)) {
    const qrPanel = el("div", "receiptQrPanel");
    qrPanel.appendChild(
      el(
        "p",
        "receiptQrFallback muted",
        "Claim code is too long for a QR on this receipt. Copy the code above to claim."
      )
    );
    claimWrap.appendChild(qrPanel);
  }

  root.appendChild(claimWrap);
  return root;
}

async function waitForImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

export async function captureElementToJpegBlob(element) {
  if (!element) throw new Error("Nothing to export.");
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(element, {
    backgroundColor: "#071226",
    scale: 2,
    useCORS: true,
    logging: false,
    ignoreElements: (node) => node?.classList?.contains?.("receiptExportIgnore"),
    onclone: (doc) => {
      const node =
        doc.querySelector(".receiptModalExport") || doc.querySelector(".receiptExportBody");
      if (node) {
        node.style.position = "static";
        node.style.left = "auto";
        node.style.top = "auto";
        node.style.zIndex = "auto";
      }
    },
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export receipt image."));
      },
      "image/jpeg",
      0.95
    );
  });
}

/**
 * @param {object} receipt — receiptModal shape
 * @returns {Promise<Blob>}
 */
export async function renderPrivpayReceiptJpegBlob(receipt) {
  const claimCode = String(receipt.claimCode || "").trim();
  let qrDataUrl = null;
  if (claimCode && canEncodeClaimInQr(claimCode)) {
    qrDataUrl = await generateClaimQrDataUrl(claimCode, {
      width: 280,
      scanOptimized: true,
    });
  }
  const node = buildReceiptExportElement(receipt, qrDataUrl);
  document.body.appendChild(node);
  try {
    await waitForImages(node);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await captureElementToJpegBlob(node);
  } finally {
    document.body.removeChild(node);
  }
}

function defaultReceiptFilename(receipt, index) {
  const stamp = new Date().toISOString().slice(0, 10);
  const kind = receipt.kind === "payroll" ? "payroll" : "bill";
  const suffix = index != null ? `_${index + 1}` : "";
  const slug = String(receipt.title || kind)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 40);
  return `privpay_${kind}_receipt_${slug || kind}_${stamp}${suffix}`;
}

export async function downloadPrivpayReceiptJpeg(receipt, _logoUrl, options = {}) {
  const blob = options.captureEl
    ? await captureElementToJpegBlob(options.captureEl)
    : await renderPrivpayReceiptJpegBlob(receipt);
  const base = options.filename || defaultReceiptFilename(receipt, options.index);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download one JPEG per receipt (e.g. history batch export). */
export async function downloadPrivpayReceiptJpegBatch(receipts, options = {}) {
  const list = Array.isArray(receipts) ? receipts.filter(Boolean) : [];
  if (!list.length) throw new Error("No receipts to export.");
  for (let i = 0; i < list.length; i++) {
    await downloadPrivpayReceiptJpeg(list[i], null, {
      index: i,
      filename: options.filenameFor?.(list[i], i),
    });
    if (i < list.length - 1 && options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
  }
}
