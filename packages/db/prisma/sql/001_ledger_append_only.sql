-- Make the credit ledger append-only at the database level.
--
-- Application code is not trusted to preserve this invariant: a single stray
-- prisma.creditTransaction.update() would silently break the balance chain and
-- the whole reward economy with it. Enforce it where it cannot be bypassed.
--
-- Applied by: pnpm --filter @aam/db db:harden
-- (Append this to the initial migration before deploying to a shared database.)

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
