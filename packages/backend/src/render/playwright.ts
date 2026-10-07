// Bounded page pool over a headless Chromium: at most `limit` pages rendered concurrently, with a
// FIFO wait queue for the rest. It reuses the host Chrome binary (overridable) and never talks to
// the project's egress proxy — this is a local replacement for the browser-rendering half of Jina.
import { chromium, type Page } from "playwright-core";

const DEFAULT_CHROME = "/usr/bin/google-chrome";
const DEFAULT_LIMIT = 3;
const NAV_TIMEOUT_MS = 25_000;
const ACQUIRE_TIMEOUT_MS = 30_000;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
// An honest, common desktop Chrome user-agent; nothing misleading about being a real browser.
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export interface RenderLease {
  page: Page;
  /** Returns the page to the pool, ready for the next render (or closes a broken one). */
  dispose(): Promise<void>;
}

export interface RenderPool {
  acquire(timeoutMs?: number): Promise<RenderLease>;
  close(): Promise<void>;
  stats(): { leased: number; queued: number };
}

interface Waiter {
  resolve(lease: RenderLease): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultLimit(): number {
  const raw = process.env.RENDER_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_LIMIT;
}

export async function openRenderPool(limit = defaultLimit()): Promise<RenderPool> {
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  const browser = await chromium.launch({
    executablePath: process.env.RENDER_CHROME_PATH || DEFAULT_CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=zh-CN"],
  });

  // Each browser.newPage() owns its own context, so per-page UA/viewport/locale never leak across
  // concurrent renders; on any failure close what we already opened and abort startup.
  const createPage = async (): Promise<Page> => {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent: USER_AGENT,
      locale: "zh-CN",
    });
    try {
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
    } catch (error) {
      try { await page.close(); } catch { /* already gone */ }
      throw error;
    }
    return page;
  };

  const pages: Page[] = [];
  try {
    for (let i = 0; i < limit; i++) pages.push(await createPage());
  } catch (error) {
    await Promise.allSettled(pages.map((p) => p.close().catch(() => {})));
    await browser.close();
    throw error;
  }

  const waiters: Waiter[] = [];
  let leased = 0;
  let closed = false;

  const leaseFor = (page: Page): RenderLease => ({
    page,
    dispose: () => dispose(page),
  });

  const dispose = async (page: Page): Promise<void> => {
    if (closed) {
      leased = Math.max(0, leased - 1);
      try { await page.close(); } catch { /* already closed */ }
      return;
    }
    // Reset the used page so the next render starts from a clean document.
    let usable = false;
    try {
      await page.goto("about:blank", { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      usable = !page.isClosed();
    } catch {
      usable = false;
    }

    if (!usable) {
      // Broken or closed: drop it and open a fresh page so the pool keeps its capacity.
      try { await page.close(); } catch { /* already gone */ }
      let replacement: Page | null = null;
      try { replacement = await createPage(); } catch { /* capacity shrinks by one */ }
      const waiter = waiters.shift();
      if (replacement && waiter) waiter.resolve(leaseFor(replacement));
      else if (replacement) { pages.push(replacement); leased = Math.max(0, leased - 1); }
      else leased = Math.max(0, leased - 1);
      return;
    }

    // Usable page: hand it to the oldest waiter, or keep it on the idle shelf (leased count drops).
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(leaseFor(page));
    else { pages.push(page); leased = Math.max(0, leased - 1); }
  };

  const acquire = (timeoutMs = ACQUIRE_TIMEOUT_MS): Promise<RenderLease> => {
    if (closed) return Promise.reject(new Error("Render pool is closed"));
    const idle = pages.pop();
    if (idle) {
      leased++;
      return Promise.resolve(leaseFor(idle));
    }
    // Pool is at capacity: wait FIFO for a page to come back.
    return new Promise<RenderLease>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (lease) => { clearTimeout(waiter.timer); resolve(lease); },
        reject: (error) => { clearTimeout(waiter.timer); reject(error); },
        timer: setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          waiter.reject(new Error(`Timed out after ${timeoutMs} ms waiting for a render page`));
        }, timeoutMs),
      };
      waiters.push(waiter);
    });
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    const pending = waiters.splice(0, waiters.length);
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Render pool is closing"));
    }
    leased = 0;
    await Promise.allSettled(pages.splice(0).map((p) => p.close().catch(() => {})));
    await browser.close();
  };

  return {
    acquire,
    close,
    stats: () => ({ leased, queued: waiters.length }),
  };
}