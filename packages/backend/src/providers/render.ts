// Client for the local headless-chromium render service (src/render/server.ts): an in-house substitute
// for the paid Jina Reader. It POSTs {url, format} to config.renderEndpoint (a trusted loopback service,
// not the public internet, so it dials directly and is not subject to the SSRF guard) and parses the
// response with the same parseJinaText() the collectors already use. Every render is a costly fetch, so
// it still goes through receipts and budgets with cost = null (guards against amplification without a
// token price). Callers that cannot reach the service fall back to Jina when a JINA_API_KEY exists.
import { fetch as undiciFetch } from "undici";
import { config } from "../config.ts";
import { paidRequest, ProviderRejectedError } from "./receipts.ts";
import { parseJinaText, type JinaPage } from "./jina.ts";

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 6 * 1024 * 1024;

/** Reads a URL through the local render service and returns the familiar Jina-shaped page. */
export async function renderRead(
  targetUrl: string,
  opts: { purpose: string; subject: string; format?: "markdown" | "html"; wait?: "static" | "dynamic"; xhrPaths?: string[]; perRead?: boolean },
): Promise<JinaPage & { receiptId: number; raw: string }> {
  const endpoint = config.renderEndpoint.replace(/\/$/, "");
  const day = opts.perRead ? new Date().toISOString() : new Date().toISOString().slice(0, 10);
  const receipt = await paidRequest(
    { service: "render", model: null, purpose: opts.purpose, subject: opts.subject, identity: { url: targetUrl, day, format: opts.format ?? "markdown", wait: opts.wait ?? "static", xhrPaths: opts.xhrPaths ?? null }, requestSummary: { url: targetUrl } },
    async () => {
      const res = await undiciFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/plain" },
        body: JSON.stringify({ url: targetUrl, format: opts.format ?? "markdown", wait: opts.wait ?? "static", xhrPaths: opts.xhrPaths ?? undefined }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) throw new ProviderRejectedError(`render HTTP ${res.status}`, res.status, res.status >= 500);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new ProviderRejectedError("render response too large", 413, false);
      const text = buf.toString("utf8").slice(0, 2_000_000);
      // Local rendering has no token price; the call is still receipted and budgeted (cost = null).
      return { response: { text, status: res.status }, usage: { bytes: buf.byteLength, tokens: null }, cost: null };
    },
  );
  const raw = String((receipt.response as { text?: string })?.text ?? "");
  return { ...parseJinaText(raw), receiptId: receipt.receiptId, raw };
}