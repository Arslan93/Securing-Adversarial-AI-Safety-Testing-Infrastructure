import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { resolve, extname } from "node:path";
export function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
  return true;
}
export async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  let raw = "",
    size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000)
      throw Object.assign(Error("Request too large"), { status: 413 });
    raw += chunk;
  }
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Error("Expected object");
    return body;
  } catch {
    throw Object.assign(Error("Request body must be valid JSON."), {
      status: 400,
    });
  }
}
export function serveStatic(req, res, url, config) {
  if (req.method !== "GET" && req.method !== "HEAD")
    return json(res, 405, { error: "Method not allowed" });
  const path = resolve(config.distPath, "." + decodeURIComponent(url.pathname));
  if (!path.startsWith(config.distPath + "/") && path !== config.distPath)
    return json(res, 403, { error: "Forbidden" });
  const file =
    existsSync(path) && statSync(path).isFile()
      ? path
      : !extname(path)
        ? resolve(config.distPath, "index.html")
        : null;
  if (!file || !existsSync(file))
    return json(res, 404, {
      error: "Resource not found. Run npm run build before npm start.",
    });
  if (!realpathSync(file).startsWith(realpathSync(config.distPath) + "/"))
    return json(res, 403, { error: "Forbidden" });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    }[extname(file)] || "application/octet-stream",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  return true;
}
