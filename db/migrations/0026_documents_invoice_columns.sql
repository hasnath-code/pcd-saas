ALTER TABLE "documents" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "invoice_subtype" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "revision_log_payload" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoice_subtype_check" CHECK (invoice_subtype IS NULL OR invoice_subtype IN ('initial', 'final'));--> statement-breakpoint
CREATE INDEX "idx_documents_payment_id" ON "documents" USING btree ("payment_id") WHERE deleted_at IS NULL AND payment_id IS NOT NULL;--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- No RLS changes — invoice-type rows ride the existing documents policies
-- from migration 0023 (documents_select / insert_org_members /
-- update_org_members / delete_org_admins). The new columns are additive
-- and defaulted; existing quote-type rows take the defaults at column-add
-- time (revision_number=0, revision_log_payload='[]', payment_id=NULL,
-- invoice_subtype=NULL).
--
-- payment_id is nullable + ON DELETE SET NULL so admin-recovery hard-delete
-- of a payment doesn't take the linked receipt with it (receipts ship in
-- Session 14). Sessions 13 doesn't populate payment_id on any row — it
-- exists now because the FK target (payments) is created in 0025; deferring
-- to Session 14 would mean a second migration that's pointless splitting.
--
-- invoice_subtype CHECK constraint allows NULL (for quote/receipt rows) and
-- 'initial' / 'final' (for invoice rows). No constraint enforces initial-
-- before-final ordering — kickoff Q3 + scope locked "no forced ordering".
--
-- revision_number + revision_log_payload are NOT NULL with defaults so the
-- column-add is safe on the existing quote rows. The defaults (0 / []) make
-- a quote's revision tracking implicitly empty; quotes don't currently use
-- the revision-log pattern, but the columns are universal to documents so
-- a future port of V1's reviseQuote can lean on the same shape.
-- =============================================================================
