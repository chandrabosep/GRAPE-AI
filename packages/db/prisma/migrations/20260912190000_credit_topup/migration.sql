-- A user buying credits by sending USDC on chain. Distinct from plan_purchase,
-- which is a subscription tier rather than a balance top-up.
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'credit_topup';
