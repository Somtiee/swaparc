# Jobs & health checks

This document is for **developers and operators** under **Security & operations** who run SwapArc in production and need a minimal map of **liveness**, **scheduled work** and **what to watch**. It complements [Relayer operations](relayer-operations.md) for the privacy-pool relay path and [Profile & system API](../build/api-reference-profile-and-system.md) for the **`GET /api/health`** response shape. Remember that **`/api/health`** does not prove Redis, RPC, or relayer health by itself; pair it with the monitors below.

## Health endpoint

Use **`GET /api/health`**. Expected response indicates service liveness.

Call it from your load balancer or orchestrator as a **process-up** check only; route deeper dependency checks through the metrics and alerts in the monitoring sections so you do not confuse “HTTP 200” with “payments and relay are healthy.”

## Scheduled jobs

SwapArc uses scheduled payment processing routes, including recurring and payroll runs.

### Cron behavior

Cron schedules are defined in deployment config. If `CRON_SECRET` is set, cron requests must include:

- `Authorization: Bearer <CRON_SECRET>`

Treat **`CRON_SECRET`** like any other bearer token: rotate it when people leave, never log it, and reject requests that omit the header when the secret is configured; otherwise your cron URLs become unauthenticated triggers.

### Execution guard

`RECURRING_SERVER_EXECUTION_ENABLED` must be `true` for server-side recurring execution.

Without that guard, scheduled HTTP hits may return success at the edge while **no** server-side bill or payroll execution runs; confirm env parity between **preview**, **staging** and **production** after every deploy.

## Production monitoring recommendations

Track **job invocation success/failure rates** so silent partial failures (HTTP 200 with no work done) do not hide behind aggregate uptime. Track **queue depth or backlog** where available so you catch growing delay before users notice missed runs. **Alert on repeated relay submission failures** because they often precede gas, nonce, or allowlist incidents. **Alert on Redis/KV connectivity degradation** because profile, relay rate limits and payment state often depend on the same datastore tier.

## Minimum operational dashboard

- API liveness (`/api/health`).
- Relay response codes by action.
- Cron run status and duration.
- RPC request errors/timeouts.
- Redis/KV error rate.

Together these five views separate “app process alive” from “economic and scheduling paths working.” If you can only add one panel after **`/api/health`**, prioritize **relay codes by action** and **cron duration**; they correlate fastest with user-visible PrivPay and recurring payment breakage.
