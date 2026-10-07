-- SWARM 护栏 1：本地渲染服务（src/render/）也走 receipts 与预算熔断，但 budgets 里没有 render 行
-- （0022 只插了 jina/socialdata/dajiala/模型服务）。checkBudget 遇不到该行直接 return（无限流），
-- 导致渲染服务既无按次计数也无熔断。这里补一行。值保持在按需低阈值，运营可在后台调，置 0 即停服。
INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES
  ('render', 30, 300, 2000, '本地 Chromium 渲染（按次计数，cost=null，bytes 如实记账）')
ON CONFLICT (service) DO NOTHING;