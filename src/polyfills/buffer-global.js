/**
 * circomlibjs / blake-hash expect Node's global `Buffer` at load time.
 * Import this module before anything that pulls in circomlibjs.
 */
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
