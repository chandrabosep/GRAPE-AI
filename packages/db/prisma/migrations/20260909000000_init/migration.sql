-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChainType" AS ENUM ('evm', 'hedera');

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('privy_embedded', 'linked_external', 'server');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('default', 'credits', 'payment');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('web', 'vscode', 'x402', 'agent');

-- CreateEnum
CREATE TYPE "AdvertiserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'awaiting_funding', 'active', 'paused', 'exhausted', 'ended');

-- CreateEnum
CREATE TYPE "OnchainMode" AS ENUM ('off', 'boost', 'require');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('view_confirmed', 'click', 'dismiss', 'why_opened');

-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM ('allowance', 'credits', 'x402');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('impression', 'engagement');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('granted', 'reversed');

-- CreateEnum
CREATE TYPE "CreditTxType" AS ENUM ('reward_earned', 'inference_spent', 'plan_purchase', 'purchase', 'refund', 'payout_debit', 'promo', 'adjustment');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('campaign_funding', 'x402_inference', 'reward_payout', 'plan_purchase');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "privy_did" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "country_code" CHAR(2),
    "roles" TEXT[] DEFAULT ARRAY['user']::TEXT[],
    "world_verified" BOOLEAN NOT NULL DEFAULT false,
    "fraud_score" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "credit_balance_micro" BIGINT NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "persona" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ads_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "include_code_context" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain_type" "ChainType" NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "is_primary_signal_source" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daily_token_allowance" INTEGER NOT NULL,
    "allowed_models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ads_enabled" BOOLEAN NOT NULL DEFAULT true,
    "price_micro" BIGINT NOT NULL DEFAULT 0,
    "max_context_chars" INTEGER NOT NULL DEFAULT 8000,
    "features" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "source" "SubscriptionSource" NOT NULL DEFAULT 'default',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client" "ClientKind" NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vscode_auth_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vscode_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "treasury_wallet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "status" "AdvertiserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "advertiser_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "budget_micro" BIGINT NOT NULL,
    "spent_micro" BIGINT NOT NULL DEFAULT 0,
    "bid_micro" BIGINT NOT NULL,
    "click_multiplier" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "daily_spend_cap_micro" BIGINT,
    "allocation" JSONB NOT NULL,
    "frequency_cap" JSONB NOT NULL DEFAULT '{"perUserPerHour":1,"perUserPerDay":3}',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "vault_key" TEXT,
    "funding_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_targeting" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intent_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_commercial_intent" TEXT NOT NULL DEFAULT 'low',
    "onchain_criteria" JSONB NOT NULL DEFAULT '{}',
    "onchain_mode" "OnchainMode" NOT NULL DEFAULT 'off',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_targeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_text" TEXT NOT NULL,
    "cta_url" TEXT NOT NULL,
    "image_url" TEXT,
    "status" "CreativeStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_impressions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "intent_id" TEXT,
    "score_total" DECIMAL(6,4) NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "signals_used" JSONB NOT NULL,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "disqualify_reason" TEXT,
    "viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_engagements" (
    "id" TEXT NOT NULL,
    "impression_id" TEXT NOT NULL,
    "type" "EngagementType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "client" "ClientKind" NOT NULL,
    "model" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "request_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "cost_micro" BIGINT NOT NULL,
    "charged_micro" BIGINT NOT NULL,
    "funding_source" "FundingSource" NOT NULL,
    "latency_ms" INTEGER,
    "stop_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_intents" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT,
    "category" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "persona" TEXT,
    "commercial_intent" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "classifier" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "language_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onchain_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onchain_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "impression_id" TEXT NOT NULL,
    "engagement_id" TEXT,
    "campaign_id" TEXT NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "charge_micro" BIGINT NOT NULL,
    "amount_micro" BIGINT NOT NULL,
    "platform_micro" BIGINT NOT NULL,
    "treasury_micro" BIGINT NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'granted',
    "credit_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "CreditTxType" NOT NULL,
    "amount_micro" BIGINT NOT NULL,
    "balance_after_micro" BIGINT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "network" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount_raw" DECIMAL(78,0) NOT NULL,
    "amount_micro" BIGINT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "campaign_id" TEXT,
    "user_id" TEXT,
    "request_id" TEXT,
    "facilitator" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "spend_micro" BIGINT NOT NULL,
    "reward_micro" BIGINT NOT NULL,
    "platform_micro" BIGINT NOT NULL,
    "treasury_micro" BIGINT NOT NULL,
    "tx_id" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_daily_stats" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "qualified" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend_micro" BIGINT NOT NULL DEFAULT 0,
    "reward_micro" BIGINT NOT NULL DEFAULT 0,
    "avg_score" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "intent_breakdown" JSONB NOT NULL DEFAULT '{}',
    "onchain_breakdown" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "campaign_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_privy_did_key" ON "users"("privy_did");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_chain_type_key" ON "wallets"("address", "chain_type");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_sessions_refresh_token_hash_key" ON "api_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "api_sessions_user_id_idx" ON "api_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vscode_auth_codes_code_hash_key" ON "vscode_auth_codes"("code_hash");

-- CreateIndex
CREATE INDEX "vscode_auth_codes_expires_at_idx" ON "vscode_auth_codes"("expires_at");

-- CreateIndex
CREATE INDEX "advertisers_org_id_idx" ON "advertisers"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_vault_key_key" ON "campaigns"("vault_key");

-- CreateIndex
CREATE INDEX "campaigns_status_starts_at_ends_at_idx" ON "campaigns"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "campaigns_advertiser_id_idx" ON "campaigns"("advertiser_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_targeting_campaign_id_key" ON "campaign_targeting"("campaign_id");

-- CreateIndex
CREATE INDEX "ad_creatives_campaign_id_idx" ON "ad_creatives"("campaign_id");

-- CreateIndex
CREATE INDEX "ad_impressions_user_id_campaign_id_created_at_idx" ON "ad_impressions"("user_id", "campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_impressions_campaign_id_created_at_idx" ON "ad_impressions"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_impressions_request_id_idx" ON "ad_impressions"("request_id");

-- CreateIndex
CREATE INDEX "ad_engagements_impression_id_type_idx" ON "ad_engagements"("impression_id", "type");

-- CreateIndex
CREATE INDEX "ai_sessions_user_id_started_at_idx" ON "ai_sessions"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_request_id_key" ON "ai_usage"("request_id");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_created_at_idx" ON "ai_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_intents_user_id_created_at_idx" ON "ai_intents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_intents_prompt_hash_created_at_idx" ON "ai_intents"("prompt_hash", "created_at");

-- CreateIndex
CREATE INDEX "ai_intents_request_id_idx" ON "ai_intents"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_signals_wallet_id_key" ON "onchain_signals"("wallet_id");

-- CreateIndex
CREATE INDEX "onchain_signals_user_id_idx" ON "onchain_signals"("user_id");

-- CreateIndex
CREATE INDEX "onchain_signals_expires_at_idx" ON "onchain_signals"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_credit_tx_id_key" ON "rewards"("credit_tx_id");

-- CreateIndex
CREATE INDEX "rewards_user_id_created_at_idx" ON "rewards"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "rewards_campaign_id_created_at_idx" ON "rewards"("campaign_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_idempotency_key_key" ON "credit_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_created_at_idx" ON "credit_transactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tx_id_key" ON "payments"("tx_id");

-- CreateIndex
CREATE INDEX "payments_kind_status_idx" ON "payments"("kind", "status");

-- CreateIndex
CREATE INDEX "payments_campaign_id_idx" ON "payments"("campaign_id");

-- CreateIndex
CREATE INDEX "settlements_campaign_id_period_end_idx" ON "settlements"("campaign_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_daily_stats_campaign_id_day_key" ON "campaign_daily_stats"("campaign_id", "day");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_sessions" ADD CONSTRAINT "api_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vscode_auth_codes" ADD CONSTRAINT "vscode_auth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_treasury_wallet_id_fkey" FOREIGN KEY ("treasury_wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targeting" ADD CONSTRAINT "campaign_targeting_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_engagements" ADD CONSTRAINT "ad_engagements_impression_id_fkey" FOREIGN KEY ("impression_id") REFERENCES "ad_impressions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intents" ADD CONSTRAINT "ai_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onchain_signals" ADD CONSTRAINT "onchain_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onchain_signals" ADD CONSTRAINT "onchain_signals_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_impression_id_fkey" FOREIGN KEY ("impression_id") REFERENCES "ad_impressions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "ad_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_credit_tx_id_fkey" FOREIGN KEY ("credit_tx_id") REFERENCES "credit_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_stats" ADD CONSTRAINT "campaign_daily_stats_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Append-only credit ledger.
-- Prisma cannot express this, and it is not optional: the balance is the tail
-- of this table, so a single stray UPDATE would silently break every balance
-- downstream of it. Enforced where application code cannot bypass it.
-- Kept in sync with prisma/sql/001_ledger_append_only.sql (re-runnable).
-- ============================================================================
CREATE OR REPLACE FUNCTION aam_block_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'credit_transactions is append-only: attempted % on id %', TG_OP, OLD.id
    USING HINT = 'Append a compensating transaction (type=adjustment) instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credit_transactions_no_update ON credit_transactions;
CREATE TRIGGER credit_transactions_no_update
  BEFORE UPDATE ON credit_transactions
  FOR EACH ROW EXECUTE FUNCTION aam_block_ledger_mutation();

DROP TRIGGER IF EXISTS credit_transactions_no_delete ON credit_transactions;
CREATE TRIGGER credit_transactions_no_delete
  BEFORE DELETE ON credit_transactions
  FOR EACH ROW EXECUTE FUNCTION aam_block_ledger_mutation();
