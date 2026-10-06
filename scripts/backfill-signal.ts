// 历史回填「信号」：让存量数据参与「信号」与「今日影响」。
// 对存量 analyses（signal IS NULL）用与评分相同的 prompt（selection-score.md）重跑评分，
// 得到 signal 后写回 analyses.signal，并把对应的 publications.is_signal 一起补齐。
//
// 一次性运维动作，不注册调度、不做后台 UI。会真实调用模型（受 MODEL_CALLS_ENABLED 控制）。
//
// 参数：
//   --limit N            只处理前 N 条（不设则全量，但每 25 条打一次进度）
//   --since YYYY-MM-DD   只处理该日（含，北京时间）之后创建的 analyses
//   --dry-run            只统计，不写库
//
// 运行：node scripts/backfill-signal.ts [选项]
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { modelFor } from "@aihot/backend/editorial/models";
import { ScoreSchema, SCORE_SYSTEM, PROMPT_VERSIONS } from "@aihot/backend/editorial/analyze";
import { scoreInputTime } from "@aihot/backend/editorial/analyze";
import { MAX_BODY_CHARS } from "@aihot/backend/editorial/writing";
import { beijingMidnight } from "@aihot/contracts/time";

interface Args {
  limit: number | null;
  dryRun: boolean;
  since: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: null, dryRun: false, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const { limit, dryRun, since } = parseArgs(process.argv.slice(2));
const sinceStart = since ? beijingMidnight(since) : null;

interface EvalRow {
  title: string;
  bodyText: string | null;
  xPost: Record<string, any> | null;
  publishedAt: Date | null;
  discoveredAt: Date;
  revision: number;
}

// 照 buildScoreInput 的格式拼评分输入（发布时间、标题、完整正文）。
function buildInput(a: EvalRow): string {
  let body: string;
  if (a.xPost) {
    const quoted = a.xPost.quoted?.text ? `\n\n[引用 ${a.xPost.quoted?.handle ? `@${a.xPost.quoted.handle}` : "原推文"}]：${a.xPost.quoted.text}` : "";
    body = `${String(a.xPost.text ?? "").trim()}${quoted}`.trim();
  } else {
    body = (a.bodyText ?? "").trim();
  }
  if (!body) body = a.title;
  const at = a.publishedAt ?? a.discoveredAt;
  return [
    "请按系统规则评估以下单篇材料所代表的事件。只输出 attentionScore。",
    `【发布时间（北京时间）】\n${at ? scoreInputTime(at) : ""}`,
    `【标题】\n${a.title.trim()}`,
    `【完整正文】\n${body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body}`,
  ].join("\n\n");
}

// 统计：缺 signal 的存量 analyses 数；以及 is_signal=false 但对应 analysis.signal=true 的出版物数（回填收益）。
async function countStats(): Promise<{ missingSignal: number; gain: number }> {
  const [missingSignal] = sinceStart
    ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analyses a WHERE a.signal IS NULL AND a.created_at >= ${sinceStart}`
    : await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analyses a WHERE a.signal IS NULL`;
  const [gain] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM publications p
    JOIN analyses a ON a.id = p.analysis_id
    WHERE p.is_signal = false AND a.signal = true`;
  return { missingSignal: missingSignal?.n ?? 0, gain: gain?.n ?? 0 };
}

// 安全阀：模型调用关闭就只做统计（不改库、不调 chatJson），返回非零退出码。
if (!config.modelCallsEnabled) {
  const { missingSignal, gain } = await countStats();
  console.log("MODEL_CALLS_ENABLED 关闭，回填需要真实模型调用；只做统计，不改库。");
  console.log(`存量缺 signal 的 analyses: ${missingSignal}`);
  console.log(`回填收益（is_signal=false 但对应 analysis.signal=true 的出版物）: ${gain}`);
  await closeDb();
  process.exit(1);
}

// 待回填的 analyses（signal IS NULL），受 --since / --limit 限制。
let rows;
if (sinceStart && limit != null) {
  rows = await sql<{ id: number; article_id: string }[]>`
    SELECT a.id, a.article_id AS "articleId" FROM analyses a
    WHERE a.signal IS NULL AND a.created_at >= ${sinceStart}
    ORDER BY a.id LIMIT ${limit}`;
} else if (sinceStart) {
  rows = await sql<{ id: number; article_id: string }[]>`
    SELECT a.id, a.article_id AS "articleId" FROM analyses a
    WHERE a.signal IS NULL AND a.created_at >= ${sinceStart}
    ORDER BY a.id`;
} else if (limit != null) {
  rows = await sql<{ id: number; article_id: string }[]>`
    SELECT a.id, a.article_id AS "articleId" FROM analyses a
    WHERE a.signal IS NULL ORDER BY a.id LIMIT ${limit}`;
} else {
  rows = await sql<{ id: number; article_id: string }[]>`
    SELECT a.id, a.article_id AS "articleId" FROM analyses a
    WHERE a.signal IS NULL ORDER BY a.id`;
}

console.log(`待回填 analyses: ${rows.length} 条${limit != null ? "（受 --limit 限制）" : ""}`);
if (rows.length === 0) {
  console.log("无待回填条目，结束。");
  await closeDb();
  process.exit(0);
}

const model = await modelFor("score");
let done = 0;
let updated = 0;

for (const r of rows) {
  // 取该 analysis 关联文章的当前内容（正文、标题、时间）用于评分输入。
  const [a] = await sql<EvalRow[]>`
    SELECT ar.title, ar.body_text AS "bodyText", ar.x_post AS "xPost",
           ar.published_at AS "publishedAt", ar.discovered_at AS "discoveredAt", ar.revision
    FROM articles ar WHERE ar.id = ${r.article_id}`;
  if (!a) continue;

  // 两次独立评分（与精选评分一致；第二次复用缓存 prompt），signal 取两次中认为真的任一次。
  let signal = false;
  let signalReason = "";
  const receiptIds: number[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const res = await chatJson({
        model,
        purpose: "score_article",
        subject: `article:${r.article_id}@${a.revision}`,
        promptVersion: PROMPT_VERSIONS.score,
        system: SCORE_SYSTEM,
        user: buildInput(a),
        schema: ScoreSchema,
        temperature: 0.2,
        maxTokens: 1024,
        attemptTag: `backfill:${r.id}:${i + 1}`,
      });
      receiptIds.push(res.receiptId);
      if (res.data.signal) {
        signal = true;
        signalReason = res.data.signalReason;
      }
    }
  } catch (error) {
    console.error(`analysis ${r.id} (${r.article_id}) 评分失败，跳过: ${String(error).slice(0, 300)}`);
    continue;
  }

  if (dryRun) {
    done += 1;
    continue;
  }

  const committed = await sql.begin(async (tx) => {
    // 只回填仍是 signal IS NULL 的 analysis（避免覆盖已经重算过的），并顺手记下依据。
    const [upd] = await tx<{ id: number }[]>`
      UPDATE analyses
      SET signal = ${signal},
          output = coalesce(output, '{}'::jsonb) || ${tx.json({ signalReason } as never)}
      WHERE id = ${r.id} AND signal IS NULL
      RETURNING id`;
    if (upd) {
      await tx`UPDATE publications SET is_signal = ${signal} WHERE article_id = ${r.article_id}`;
    }
    for (const id of receiptIds) await completeReceipt(tx, id);
    return !!upd;
  });

  if (committed) updated += 1;
  done += 1;
  if (done % 25 === 0) console.log(`已处理 ${done}/${rows.length}`);
}

console.log(`完成：处理 ${done} 条，写回 ${updated} 条${dryRun ? "（--dry-run，未写库）" : ""}。`);
await closeDb();