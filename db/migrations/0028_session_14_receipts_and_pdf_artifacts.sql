ALTER TABLE "documents" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_files_source_document_id" ON "project_files" USING btree ("source_document_id") WHERE deleted_at IS NULL AND source_document_id IS NOT NULL;--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- Phase 2 Session 14 — additive nullable columns. Phase 1c is closed
-- (Hard Rule 1) so the only schema motion is additive.
--
-- documents.recipient_name (nullable):
--   Receipts need a revisable "addressed to" field. Quotes/invoices currently
--   have no recipient column on the row — the email-render path looks up the
--   project's primary client at send time and never stores it. Receipts need
--   recipient revisability that's independent of the underlying clients row,
--   so we snapshot at receipt creation. The recipient is set by recordPayment
--   (joined from the project's primary client) and edited by reviseReceipt.
--   Quotes and invoices keep this NULL — could host a future "billed-to"
--   override there as an additive use, but Session 14 does not.
--
-- project_files.source_document_id (nullable, indexed):
--   Lookup "is there a generated PDF for this document already?" without
--   parsing storage paths or JSON metadata. Existing rows (surveyor_upload /
--   client_upload) take NULL — only document_artifact rows populated by
--   generateDocumentPdf carry a value.
--
--   ON DELETE SET NULL: a soft-deleted document can be admin-restored without
--   losing its cached PDF; a hard-deleted document drops the FK to NULL and
--   the orphan project_files row remains until the retention worker reaps
--   it. Same shape as the documents.payment_id FK (Session 13 migration 0026).
--
--   Partial index — WHERE deleted_at IS NULL AND source_document_id IS NOT
--   NULL — keeps the index narrow and matches the project_files convention
--   (idx_project_files_project also uses the WHERE deleted_at IS NULL clause).
--   The find-or-create PDF lookup is a single index probe.
--
-- No RLS changes — both new columns ride existing policies:
--   - documents.recipient_name reads/writes through documents_select / _insert
--     _org_members / _update_org_members from migration 0023. The same
--     can_view_financials gate already covers visibility.
--   - project_files.source_document_id reads/writes through project_files
--     policies from migration 0018. The same SELECT branches (org-member
--     vs can_view_drawings stakeholder + visibility=org_and_stakeholders)
--     gate the row regardless of whether source_document_id is set.
--
-- No DEBT-064-style backfill needed — both columns default to NULL and have
-- no notification-prefs interaction.
