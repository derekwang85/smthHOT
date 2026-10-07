// One URL rendered in Chromium into the same JinaPage shape the collectors already understand. The
// article body is reused from the shared readability pipeline (content/extract.ts) and turned into
// markdown with Turndown; a plain-text fallback keeps a JS-rendered page usable by fromMarkdown.
//
// With format="html" the whole rendered DOM is returned (not the readability-cleaned body): Chromium has
// already run the page so its JS-lazy-loaded list links are present, which lets the collector feed that
// DOM to fromHtml and read card links those pages never put in static HTML. Nothing in the collectors
// requested format="html" until the "rendered + itemSelector" listing path, so changing its payload from
// a cleaned body to the full DOM is backward-compatible.
import TurndownService from "turndown";
import * as cheerio from "cheerio";
import type { Page, Response } from "playwright-core";
import { readable } from "../content/extract.ts";
import { collapseWhitespace } from "../lib/text.ts";
import type { JinaPage } from "../providers/jina.ts";
import type { RenderPool } from "./playwright.ts";

const NAV_TIMEOUT_MS = 25_000;
// SWARM 护栏 4: a dynamic render gets a hard wall-clock budget (under the client's 60s) that covers
// scrolling and XHR waiting; past it we return whatever was captured instead of hanging the pool slot.
const DYNAMIC_BUDGET_MS = 45_000;
// SWARM 护栏 2: each captured XHR segment is capped, the count is capped, and so is the total, so a
// listing whose list JSON is huge cannot push the envelope (and the receipt) past its bounds.
const MAX_XHR_SEGMENTS = 5;
const MAX_XHR_SEG_BYTES = 1024 * 1024; // 1 MB per segment
const MAX_XHR_TOTAL_BYTES = 6 * 1024 * 1024; // 6 MB across the run
const MAX_SCROLLS = 5;

/**
 * How captured XHR segments are joined into the envelope's `XHR Responses:` section. Consumers split on
 * this exact delimiter; it is a line JSON would never begin with, so JSON responses stay parseable.
 */
export const XHR_SEGMENT_SEP = "\n---XHR-SEGMENT---\n";

const turndown = new TurndownService({ headingStyle: "atx" });

export interface RenderOptions {
  format?: "markdown" | "html";
  /**
   * "static" (default) waits for networkidle and reads the DOM once. "dynamic" additionally scrolls the
   * page to the bottom a few times and captures the JSON responses of the configured xhrPaths, for
   * listings whose items only the page's post-load XHR/scroll pagination injects.
   */
  wait?: "static" | "dynamic";
  xhrPaths?: string[];
  /** Client-side cancellation: when aborted, a running acquire/scroll/capture releases the pool slot early. */
  signal?: AbortSignal;
}

export async function renderUrl(pool: RenderPool, url: string, opts: RenderOptions = {}): Promise<JinaPage> {
  const format = opts.format === "html" ? "html" : "markdown";
  const dynamic = opts.wait === "dynamic";
  // Combine the client's disconnect signal with the wall-clock budget into one cancellation signal.
  const budget = dynamic ? AbortSignal.timeout(DYNAMIC_BUDGET_MS) : null;
  const signal = budget && opts.signal ? AbortSignal.any([budget, opts.signal]) : (opts.signal ?? budget ?? undefined);
  const lease = await pool.acquire();
  let html = "";
  let finalUrl = url;
  const captured: string[] = [];
  const pendingResponses: Response[] = [];
  let removeResponseListener: (() => void) | null = null;
  try {
    // Prefer a fully-loaded page; if that never settles, still read the DOM once rendered to
    // "domcontentloaded" rather than giving up on a legitimate page.
    try {
      await lease.page.goto(url, { waitUntil: networkIdle(dynamic), timeout: NAV_TIMEOUT_MS, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      await lease.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS, signal }).catch(() => {});
    }
    finalUrl = lease.page.url() || url;
    if (dynamic) removeResponseListener = captureResponses(lease.page, opts.xhrPaths ?? [], pendingResponses);
    if (dynamic) await scrollToLoad(lease.page, signal);
    await readCaptured(pendingResponses, captured);
    html = await lease.page.content();
  } finally {
    removeResponseListener?.();
    await lease.dispose();
  }

  const page = parseRendered(html, finalUrl);
  if (format === "html") {
    // The whole rendered document, JS-lazy list links included, so fromHtml can parse listing cards.
    return { ...page, markdown: html, xhrResponses: captured.length ? captured.join(XHR_SEGMENT_SEP) : null };
  }
  const body = readable(html, finalUrl);
  return { ...page, markdown: body ? turndown.turndown(body.html) : textFallback(html), xhrResponses: captured.length ? captured.join(XHR_SEGMENT_SEP) : null };
}

function networkIdle(dynamic: boolean): "networkidle" | "domcontentloaded" {
  // A static render waits for quiet; a dynamic one is already going to scroll, so it only needs the
  // document loaded before the XHR listeners and scrolling start.
  return dynamic ? "domcontentloaded" : "networkidle";
}

/** Registers a response listener for this render only; returns an unregister function (SWARM 护栏 3). */
function captureResponses(page: Page, xhrPaths: string[], out: Response[]): () => void {
  const seen = new Set<Response>();
  const onResponse = (res: Response) => {
    if (out.length >= MAX_XHR_SEGMENTS) return;
    const requestUrl = res.url();
    const hit = xhrPaths.some((p) => p && requestUrl.includes(p));
    if (hit) seen.add(res);
  };
  page.on("response", onResponse);
  return () => {
    page.removeListener("response", onResponse);
    for (const res of seen) if (!out.includes(res)) out.push(res);
  };
}

/** Scrolls to the bottom a few times, letting scroll-triggered pagination fetch more items. */
async function scrollToLoad(page: Page, signal: AbortSignal | undefined): Promise<void> {
  for (let i = 0; i < MAX_SCROLLS; i++) {
    if (signal?.aborted) break;
    try {
      // End-scroll is a scroll event most infinite-list views listen to; with the target lib lacking DOM
      // globals, the wheel path avoids `window`/`document` symbols that would not type-check.
      await page.mouse.wheel(0, 200_000);
      await page.waitForTimeout(1200);
    } catch {
      break; // a closed/crashed page stops scrolling; we still return what we captured
    }
  }
}

/** Reads the captured responses' bodies, capped per segment and in total (SWARM 护栏 2). */
async function readCaptured(responses: Response[], out: string[]): Promise<void> {
  const bodies = await Promise.all(responses.map((r) => r.body().catch(() => null as Buffer | null)));
  let total = 0;
  for (const b of bodies) {
    if (!b) continue;
    if (out.length >= MAX_XHR_SEGMENTS) break;
    total += b.byteLength;
    if (total > MAX_XHR_TOTAL_BYTES) break;
    out.push(b.slice(0, MAX_XHR_SEG_BYTES).toString("utf8"));
  }
}

function parseRendered(html: string, url: string): Omit<JinaPage, "markdown"> {
  const $ = cheerio.load(html);
  const title = ($("h1").first().text().trim() || $("title").first().text().trim() || $('meta[property="og:title"]').attr("content") || "").trim() || null;
  const when = $('meta[property="article:published_time"]').attr("content") || $("time[datetime]").first().attr("datetime") || $('[itemprop="datePublished"]').first().attr("content");
  const publishedTime = (when ? when.trim() : "") || null;
  return { title, url: url || null, publishedTime };
}

/** Readable text of the whole rendered document; a markdown parse of it still yields the links in text. */
function textFallback(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,link,meta,svg").remove();
  return collapseWhitespace($("body").text() || $("html").text());
}