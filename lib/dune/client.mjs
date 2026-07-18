/**
 * Minimal Dune API client (upload tables, create/update queries).
 * Requires DUNE_API_KEY with Read/Write scope.
 */

const API_BASE = "https://api.dune.com/api";

export class DuneApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "DuneApiError";
    this.status = status;
    this.body = body;
  }
}

export function requireApiKey() {
  const key = String(process.env.DUNE_API_KEY || "").trim();
  if (!key) {
    throw new Error(
      "DUNE_API_KEY is missing. Add it to .env from dune.com → Settings → API → Create key (Read/Write scope)."
    );
  }
  return key;
}

async function duneFetch(path, { method = "GET", body } = {}) {
  const apiKey = requireApiKey();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "X-DUNE-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new DuneApiError(json?.error || `Dune API ${res.status}`, {
      status: res.status,
      body: json,
    });
  }
  return json;
}

/** Upload CSV string; overwrites table if it already exists. */
export async function uploadCsv({ data, tableName, description, isPrivate = false }) {
  return duneFetch("/v1/uploads/csv", {
    method: "POST",
    body: {
      data,
      table_name: tableName,
      description,
      is_private: isPrivate,
    },
  });
}

export async function listUploads() {
  return duneFetch("/v1/uploads");
}

export async function createQuery({ name, sql, description, parameters = [], isPrivate = false, tags = [] }) {
  return duneFetch("/v1/query", {
    method: "POST",
    body: {
      name,
      query_sql: sql,
      description,
      parameters,
      is_private: isPrivate,
      tags,
    },
  });
}

export async function updateQuery(queryId, { name, sql, description, parameters, tags }) {
  const body = {};
  if (name != null) body.name = name;
  if (sql != null) body.query_sql = sql;
  if (description != null) body.description = description;
  if (parameters != null) body.parameters = parameters;
  if (tags != null) body.tags = tags;
  return duneFetch(`/v1/query/${queryId}`, { method: "PATCH", body });
}

export async function executeQuery(queryId) {
  return duneFetch(`/v1/query/${queryId}/execute`, { method: "POST", body: {} });
}

export async function archiveQuery(queryId) {
  return duneFetch(`/v1/query/${queryId}/archive`, { method: "POST", body: {} });
}

export function namespaceFromFullName(fullName) {
  // dune.somtochukwuogodinmagmailcom.swaparc_network_totals → somtochukwuogodinmagmailcom
  const parts = String(fullName || "").split(".");
  if (parts.length >= 3 && parts[0] === "dune") return parts[1];
  return String(process.env.DUNE_NAMESPACE || "").trim() || null;
}
