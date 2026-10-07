// Stand-alone process entry: a tiny HTTP API wrapping the Chromium render pool, emitting the same
// plain-text envelope as Jina Reader so the existing parseJinaText() works unchanged.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { openRenderPool } from "./playwright.ts";
import { renderUrl, type RenderOptions } from "./render.ts";
import type { JinaPage } from "../providers/jina.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RENDER_PORT || 3003);
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

const pool = await openRenderPool();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const path = new URL(req.url ?? "/", `http://${HOST}`).pathname;
  if (req.method === "GET" && path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, stats: pool.stats() }));
    return;
  }
  if (req.method === "POST" && (path === "/" || path === "/render")) {
    await handleRender(req, res);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  if (body.payloadTooLarge) {
    res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
    res.end("payload too large");
    return;
  }
  if (!body.ok) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("invalid JSON body");
    return;
  }
  const parsed = body.data as { url?: unknown; format?: unknown; wait?: unknown; xhrPaths?: unknown } | null;
  const target = typeof parsed?.url === "string" ? parsed.url.trim() : "";
  if (!target || !isHttpUrl(target)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("url required and must be http(s)");
    return;
  }
  const opts: RenderOptions = parsed?.format === "html" ? { format: "html" } : {};
  if (parsed?.wait === "dynamic") opts.wait = "dynamic";
  if (Array.isArray(parsed?.xhrPaths)) {
    const paths = parsed.xhrPaths.filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length) opts.xhrPaths = paths.slice(0, 8);
  }
  // SWARM 护栏 4-信号: a client that hangs up cancels the running render (acquire, scroll, XHR capture)
  // and frees the pool slot through renderUrl's signal, instead of spending a slot on a dead client.
  const cancelled = new AbortController();
  const onClose = () => cancelled.abort();
  req.once("close", onClose);
  try {
    const page = await renderUrl(pool, target, { ...opts, signal: cancelled.signal });
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(jinaText(page));
  } catch (error) {
    console.error(`render failed for ${target}:`, error instanceof Error ? error.message : String(error));
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("render failed");
  } finally {
    req.removeListener("close", onClose);
  }
}

/** Streams the request body up to MAX_BODY_BYTES; larger requests are refused with 413. */
function readBody(req: IncomingMessage): Promise<{ payloadTooLarge: boolean; ok: boolean; data?: unknown }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { payloadTooLarge: boolean; ok: boolean; data?: unknown }) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ payloadTooLarge: true, ok: false });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        finish({ payloadTooLarge: false, ok: true, data: {} });
        return;
      }
      try {
        finish({ payloadTooLarge: false, ok: true, data: JSON.parse(raw) });
      } catch {
        finish({ payloadTooLarge: false, ok: false });
      }
    });
    req.on("error", () => finish({ payloadTooLarge: false, ok: false }));
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function oneLine(value: string | null): string {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function jinaText(page: JinaPage): string {
  const parts = [
    `Title: ${oneLine(page.title)}`,
    `URL Source: ${oneLine(page.url)}`,
    `Published Time: ${oneLine(page.publishedTime)}`,
    "Markdown Content:",
    page.markdown,
  ];
  // A scrolled listing carries the captured XHR JSON as the envelope's last section; parseJinaText
  // strips it off again, so the common markdown path never sees it (SWARM 护栏 5).
  if (page.xhrResponses) parts.push("XHR Responses:", page.xhrResponses);
  return parts.join("\n");
}

server.listen(PORT, HOST, () => console.log(`render server listening on ${HOST}:${PORT}`));

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`received ${signal}, shutting down`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.close();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));