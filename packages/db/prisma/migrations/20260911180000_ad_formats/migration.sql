-- Two sponsored formats instead of one.
--
-- A campaign can now carry a banner card and a single-line inline ad, written
-- and reported separately rather than as two renderings of the same copy.
--
-- Everything here is additive and backfills to the existing behaviour: every
-- creative that exists today is a banner, and every impression already served
-- was a banner charged at the campaign's full bid.

CREATE TYPE "CreativeFormat" AS ENUM ('banner', 'inline');

-- Existing rows are banners, which is exactly what the default says.
ALTER TABLE "ad_creatives"
    ADD COLUMN "format" "CreativeFormat" NOT NULL DEFAULT 'banner';

-- An inline creative is one line: it has no body. Banners keep theirs, so this
-- only relaxes the column rather than clearing anything.
ALTER TABLE "ad_creatives" ALTER COLUMN "body" DROP NOT NULL;

-- One creative per format per campaign, so "the inline creative" is a single
-- unambiguous row rather than whichever happened to be written first.
CREATE UNIQUE INDEX "ad_creatives_campaign_id_format_key"
    ON "ad_creatives"("campaign_id", "format");

-- Denormalised onto the impression so per-format reporting never joins back to
-- the creative, which may since have been edited or deleted.
ALTER TABLE "ad_impressions"
    ADD COLUMN "format" "CreativeFormat" NOT NULL DEFAULT 'banner';

-- What the campaign was actually charged for this impression.
--
-- The inline slot bills at a fraction of the bid, so the campaign's current
-- bid_micro is no longer the answer. Recording the charge at serve time is what
-- keeps a reward derived from it — a user must never be paid more than the
-- advertiser was charged — correct after a bid edit or a config change.
--
-- Zero on historical rows is deliberate and meaningful: it marks a row from
-- before this column existed, for which the campaign bid is the right answer,
-- and the reward path reads it that way.
ALTER TABLE "ad_impressions"
    ADD COLUMN "charged_micro" BIGINT NOT NULL DEFAULT 0;

CREATE INDEX "ad_impressions_campaign_id_format_created_at_idx"
    ON "ad_impressions"("campaign_id", "format", "created_at");
