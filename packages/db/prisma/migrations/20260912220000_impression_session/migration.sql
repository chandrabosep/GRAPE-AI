-- Which conversation an impression was shown in.
--
-- `maxAdsPerSession` was being enforced against a count of every impression the
-- user had in the last 24 hours, because there was no column to scope it to a
-- session. A limit of 10 per conversation therefore behaved as a hard 10-per-day
-- wall, and ads stopped for the rest of the day with no visible reason.
--
-- Nullable on purpose: rows written before this existed belong to no known
-- session, so they count against none.
ALTER TABLE "ad_impressions" ADD COLUMN IF NOT EXISTS "session_id" TEXT;

CREATE INDEX IF NOT EXISTS "ad_impressions_user_id_session_id_idx"
  ON "ad_impressions" ("user_id", "session_id");
