# 1) Goals

* Serve HTTP/HTTPS traffic through a **Cloudflare Worker** acting as a lightweight L7 load balancer.
* **No sticky sessions**; every request may hit any healthy origin.
* **Stateless per request** (no durable state), ensuring lowest possible cost/complexity.
* Add **configurable CORS** (origin allowlist, methods, headers, credentials, max-age).
* Allow **adding/removing origins via environment variables** (redeploy to apply).

# 2) Non-Goals

* No built-in geo steering, weighted distribution, or real health cache across POPs.
* No Cloudflare Load Balancer product, Spectrum, DO, or KV (to minimize cost).
* No WebSocket upgrade handling (can be added later if needed).

# 3) High-Level Architecture

Client → Cloudflare (proxy/WAF) → **Worker (LB + CORS)** → Origin Pool (N nodes, HTTPS recommended or via Cloudflare Tunnel)

* The Worker **receives all requests**, applies **CORS policy** (including preflight).
* For non-preflight requests, Worker **selects an origin** (randomized order each request), **proxies** with a short **timeout** and **retry** behavior.
* If the selected origin returns a configured “fail” status or times out, the Worker **retries** another origin (bounded by `RETRIES`).
* On persistent failure across all eligible origins → **502**.

# 4) Configuration (Environment Variables)

(All strings in `wrangler.toml` under `[vars]` or `.dev.vars` in local dev.)

Required:

* `ORIGINS`: Comma-separated list of base URLs.
  Example: `https://vm-a.example.com,https://vm-b.example.com`

Proxy/Fallback:

* `ORIGIN_TIMEOUT_MS`: Per-origin timeout (default 8000; min 1000, max 90000)
* `RETRIES`: Number of additional origins to try (default 1; min 0, max 5)
* `FAIL_STATUSES`: Comma-separated HTTP codes treated as “fail” (default `521,522,523,504,500`)

CORS:

* `CORS_ENABLED`: `"true" | "false"` (default `false`)
* `CORS_ALLOW_ORIGINS`: Comma-separated allowlist of origins. Supports `"*"` for wildcard (see “CORS Behavior”).
  Example: `https://app.example.com,https://admin.example.com` or `*`
* `CORS_ALLOW_METHODS`: Comma-separated methods (default `GET,POST,PUT,PATCH,DELETE,OPTIONS`)
* `CORS_ALLOW_HEADERS`: Comma-separated headers allowed in requests (default `Content-Type,Authorization`)
* `CORS_EXPOSE_HEADERS`: Comma-separated response headers exposed to JS (optional)
* `CORS_ALLOW_CREDENTIALS`: `"true" | "false"` (default `false`)
* `CORS_MAX_AGE_SEC`: Integer seconds to cache preflight (default `600`)

Diagnostics (optional):

* `LB_DIAG_PATH`: Path for LB diagnostics endpoint (default `/__lb/health`) — returns simple JSON.

# 5) Request Flow

1. **Preflight (OPTIONS)**

   * If `CORS_ENABLED=true` and request is CORS preflight (has `Origin`, `Access-Control-Request-Method`):

     * Validate request origin against `CORS_ALLOW_ORIGINS`.
     * If allowed → return **204** with appropriate `Access-Control-Allow-*` headers.
     * If not allowed → return **403** (or **204** with no CORS headers; choose strict mode in Security).
   * If CORS disabled → return **204** with no CORS headers.

2. **Simple/Actual Request**

   * If `CORS_ENABLED=true`: validate `Origin`; if allowed, attach `Access-Control-Allow-Origin` (+ credentials if configured) and optional `Access-Control-Expose-Headers` to the **proxied response**.
   * Build origin candidate list from `ORIGINS`, **shuffle** to randomize distribution per request.
   * For each candidate (up to `RETRIES + 1` attempts):

     * Proxy the request to the origin with `fetch()` and an AbortSignal timeout (`ORIGIN_TIMEOUT_MS`).
     * If network error/timeout or response status is in `FAIL_STATUSES`, try next origin.
     * On success, return origin response (with CORS headers if enabled).
   * If all fail → return **502**.

# 6) CORS Behavior (precise)

* **Allowlist check**:

  * If `CORS_ALLOW_ORIGINS="*"`:

    * If `CORS_ALLOW_CREDENTIALS="true"` → **do not** echo `"*"` (not allowed by spec with credentials); instead, **echo the request Origin** when present.
    * If `CORS_ALLOW_CREDENTIALS="false"` → return `Access-Control-Allow-Origin: *`.
  * If a **comma list**: origin must match exactly (string compare) to be allowed; otherwise not allowed.
* **Headers**:

  * `Access-Control-Allow-Methods`: from env or default list.
  * `Access-Control-Allow-Headers`: echo `Access-Control-Request-Headers` if present; else use env default.
  * `Access-Control-Max-Age`: from `CORS_MAX_AGE_SEC` on preflight responses.
  * `Access-Control-Allow-Credentials`: only when `CORS_ALLOW_CREDENTIALS="true"`.
* **Security**: If not allowed, either:

  * **Strict**: return **403** (recommended for APIs).
  * **Lenient**: return 2xx with **no CORS headers** (browser will block).

# 7) Error Handling

* **Timeouts**: Abort origin fetch when exceeding `ORIGIN_TIMEOUT_MS`, then attempt next origin.
* **Fail Codes**: If response status is in `FAIL_STATUSES`, treat as failed and try next origin.
* **Exhausted**: If no origin succeeds → **502** with short message.
* **CORS Deny**: **403** with brief JSON (`{"error":"cors_denied"}`) in strict mode.

# 8) Security Considerations

* Keep `ORIGINS` strictly HTTPS (or use Cloudflare Tunnel) to hide real VM IPs.
* Set a **tight timeout** (2–8s) and **small retries** (0–1) to avoid request amplification during partial outages.
* Carefully set `CORS_ALLOW_ORIGINS`; avoid `*` with credentials.
* Optionally enforce an **allowlist of paths** if only certain routes should be exposed.

# 9) Observability

* Return a lightweight diagnostic at `LB_DIAG_PATH` with:

  * configured origins, runtime values (timeout, retries), and process timestamp.
* Rely on Cloudflare logs/analytics for request volume, errors, latency percentiles.
* (Optional) Add a small `cf-ray`/trace header passthrough for debugging.

# 10) Local Testing & Setup

**Prereqs**: Node 18+, `npm i -g wrangler`

Project skeleton:

```
/edge-lb-min
  ├─ wrangler.toml
  ├─ .dev.vars
  └─ src/worker.js
```

**wrangler.toml**

```toml
name = "edge-lb-min"
main = "src/worker.js"
compatibility_date = "2025-08-10"

[dev]
port = 8787
```

**.dev.vars** (example)

```
ORIGINS=http://localhost:9001,http://localhost:9002
ORIGIN_TIMEOUT_MS=3000
RETRIES=1
FAIL_STATUSES=521,522,523,504,500

CORS_ENABLED=true
CORS_ALLOW_ORIGINS=http://localhost:3000
CORS_ALLOW_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOW_HEADERS=Content-Type,Authorization
CORS_EXPOSE_HEADERS=X-Origin
CORS_ALLOW_CREDENTIALS=false
CORS_MAX_AGE_SEC=600

LB_DIAG_PATH=/__lb/health
```

**Dev commands**

```bash
npm init -y
npm i --save-dev wrangler
npx wrangler dev
# then hit http://localhost:8787 and http://localhost:8787/__lb/health
```

**Mock origins**
Spin up two minimal HTTP servers (e.g., on ports 9001, 9002) to test success/fail/timeout behavior (as you already have).

# 11) Deployment

```bash
# set production vars in wrangler.toml [vars] or via CLI
npx wrangler deploy
# (optionally) set vars:
# npx wrangler vars set ORIGINS
# npx wrangler vars set CORS_ALLOW_ORIGINS
```

# 12) Rollout / Rollback

* **Change origins**: update `ORIGINS` and redeploy (atomic).
* **Rollback**: redeploy previous Worker version via Wrangler.
* Use short **timeouts** and minimal **retries** to reduce blast radius during a bad rollout.

# 13) Limitations

* No global health cache (stateless). If an origin is intermittently failing, each request may still probe it once before retrying others.
* No sticky session (by design). Use cookie/JWT/Redis-backed sessions in your app if needed.
* Subrequest timeouts in Workers are finite; long-running requests should stream or respond quickly.
* Per-POP behavior may vary slightly due to randomized selection.

# 14) Future Enhancements (still inexpensive)

* **Soft health memory** using the **Cache API** (per-POP, short TTL) to reduce repeated hits to a bad origin.
* **Weighted distribution**: add `WEIGHTS` env (JSON) to bias selection.
* **Route policies**: different timeouts/retries per path prefix.
* **Basic rate limiting** at the edge (per IP) to prevent overload before hitting origins.

