-- Wallet-based sign-in replaces Privy.
--
-- Prisma's generated diff wanted to DROP privy_did and ADD subject, which would
-- have deleted every existing identity and orphaned the credit ledger attached
-- to it. This is a rename, so it is written as one.

-- Identity is now provider-prefixed rather than Privy-specific.
ALTER TABLE "users" RENAME COLUMN "privy_did" TO "subject";
ALTER INDEX "users_privy_did_key" RENAME TO "users_subject_key";

-- Move seeded accounts off the privy namespace, preserving their rows and all
-- ledger history hanging off them.
UPDATE "users"
   SET "subject" = 'seed:' || substring("subject" from 'did:privy:seed-(.*)$')
 WHERE "subject" LIKE 'did:privy:seed-%';

-- SIWE replay protection depends on the server issuing a nonce and accepting it
-- exactly once, so nonces must be stored rather than derived.
CREATE TABLE "auth_nonces" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_nonces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_nonces_nonce_key" ON "auth_nonces"("nonce");
CREATE INDEX "auth_nonces_expires_at_idx" ON "auth_nonces"("expires_at");
