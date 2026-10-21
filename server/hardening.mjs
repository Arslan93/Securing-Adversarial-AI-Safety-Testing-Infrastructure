import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
export function secureHeaders(res, config) {
  res.setHeader("X-Request-ID", randomUUID());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
  );
  if (config.pilotMode)
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
}
export function requirePilotTransport(req, url, config) {
  const peer = req.socket?.remoteAddress,
    loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
  if (!config.pilotMode) return peer || "unknown";
  if (
    loopback &&
    req.method === "GET" &&
    ["/api/health/live", "/api/health/ready"].includes(url.pathname)
  )
    return peer;
  if (
    !config.trustProxy ||
    !loopback ||
    req.headers["x-forwarded-proto"] !== "https" ||
    req.headers["x-forwarded-host"] !== new URL(config.publicOrigin).host
  )
    throw Object.assign(
      Error("Restricted pilot requires the trusted local HTTPS proxy."),
      { status: 403 },
    );
  const client = req.headers["x-forwarded-for"];
  return typeof client === "string" && isIP(client) ? client : peer;
}
export function createRequestLimiter({
  limit = 240,
  windowMs = 60000,
  maxEntries = 10000,
} = {}) {
  const entries = new Map();
  return (key, now = Date.now()) => {
    for (const [k, v] of entries) if (v.until <= now) entries.delete(k);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxEntries) return false;
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}
