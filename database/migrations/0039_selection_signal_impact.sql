-- Selection signal + today-impact fields (ADR commodityHOT-selection-impact-adr.md).
-- Backward-compatible increments only: existing rows and read paths are unaffected.

-- analyses: whether the material is a "signal" (has marginal impact) rather than routine
-- data reporting. Only signal items enter the pooled ranking (selection.rank) and the
-- today-impact candidates.
ALTER TABLE analyses ADD COLUMN signal boolean;

-- publications: the public projection joins the pooled selection and today-impact marks.
-- is_signal carries the latest analysis' signal; impact_score and impact_basis carry the
-- today-impact transmission assessment written by the impact job.
ALTER TABLE publications ADD COLUMN is_signal boolean NOT NULL DEFAULT false;
ALTER TABLE publications ADD COLUMN impact_score numeric(5, 2);
-- JSON shape: { kind: "supply"|"demand"|"macro"|"price-only", hit: ["stock","basis","margin"], resonSources: int, assessedAt: iso }
ALTER TABLE publications ADD COLUMN impact_basis jsonb;

-- Today's impact list is read as the top impact_score among today's signal items.
CREATE INDEX publications_impact_idx ON publications (impact_score DESC)
  WHERE visibility = 'public' AND impact_score IS NOT NULL;