/**
 * Encrypted storage for PRIVPAY ZK note secrets (browser).
 * Uses AES-GCM; passphrase mode uses PBKDF2. Session mode derives key from a tab-scoped secret.
 */

const LS_NOTES = "privpay_zk_notes_v1";

function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function fromB64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

async function deriveKeyFromPassphrase(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey("raw", utf8(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function importSessionRawKey(raw32) {
  return crypto.subtle.importKey("raw", raw32, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** @returns {Promise<{ salt?: string, iv: string, data: string, mode: 'passphrase' | 'session' }>} */
export async function encryptNoteSecrets({ secretHex, nullifierHex }, passphrase) {
  const payload = utf8(JSON.stringify({ secretHex, nullifierHex }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  if (passphrase && String(passphrase).length >= 8) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPassphrase(String(passphrase), salt);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
    return { mode: "passphrase", salt: b64(salt), iv: b64(iv), data: b64(data) };
  }
  let rawHex = sessionStorage.getItem("privpay_sess_aes");
  if (!rawHex || rawHex.length !== 64) {
    const r = crypto.getRandomValues(new Uint8Array(32));
    rawHex = [...r].map((x) => x.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem("privpay_sess_aes", rawHex);
  }
  const raw = Uint8Array.from({ length: 32 }, (_, i) => parseInt(rawHex.slice(i * 2, i * 2 + 2), 16));
  const key = await importSessionRawKey(raw);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
  return { mode: "session", iv: b64(iv), data: b64(data) };
}

export async function decryptNoteSecrets(enc, passphrase) {
  const iv = fromB64(enc.iv);
  const data = fromB64(enc.data);
  let key;
  if (enc.mode === "passphrase") {
    if (!passphrase || String(passphrase).length < 8) throw new Error("Passphrase required (min 8 characters).");
    const salt = fromB64(enc.salt);
    key = await deriveKeyFromPassphrase(String(passphrase), salt);
  } else {
    const rawHex = sessionStorage.getItem("privpay_sess_aes");
    if (!rawHex || rawHex.length !== 64) {
      throw new Error("Session encryption key missing — use the same browser tab or restore a passphrase backup.");
    }
    const raw = Uint8Array.from({ length: 32 }, (_, i) => parseInt(rawHex.slice(i * 2, i * 2 + 2), 16));
    key = await importSessionRawKey(raw);
  }
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  const { secretHex, nullifierHex } = JSON.parse(new TextDecoder().decode(plain));
  if (!secretHex || !nullifierHex) throw new Error("Invalid decrypted note payload.");
  return { secretHex, nullifierHex };
}

function loadAll() {
  try {
    const raw = localStorage.getItem(LS_NOTES);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveAll(arr) {
  localStorage.setItem(LS_NOTES, JSON.stringify(arr));
}

export function listZkNotes() {
  return loadAll();
}

export function removeZkNote(id) {
  const next = loadAll().filter((n) => n.id !== id);
  saveAll(next);
}

/**
 * @param {object} meta
 * @param {{ secretHex: string, nullifierHex: string }} material
 */
export async function persistZkNote(meta, material, passphrase) {
  const enc = await encryptNoteSecrets(material, passphrase);
  const note = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    enc,
    ...meta,
  };
  const all = loadAll();
  all.push(note);
  saveAll(all);
  return note;
}

export function buildZkNoteBackupJson(note, metaForExport) {
  return JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), note, meta: metaForExport }, null, 2);
}

export function importZkNoteFromBackupJson(text) {
  const j = JSON.parse(text);
  const note = j.note || j;
  if (!note.id || !note.enc || !note.poolAddress) throw new Error("Invalid backup file.");
  const all = loadAll();
  if (all.some((n) => n.id === note.id)) return note.id;
  all.push(note);
  saveAll(all);
  return note.id;
}
