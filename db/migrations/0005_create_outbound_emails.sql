-- Small lookup table for Resend webhook → org resolution. Written at send
-- time by lib/email/send.ts; read by lib/webhooks/resend.ts to populate
-- email_events.org_id from message_id. Spec §16, the 10th Phase 1a table —
-- deferred from Session 2 because no email had a real message_id to log
-- until Session 4 wires real Resend.
--
-- Resend webhook payloads include `tags` (best-effort echo) and `data.email_id`
-- (always present). Tags are not always echoed in every event type, so a
-- deterministic lookup table beats relying on tag round-trip.

CREATE TABLE "outbound_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"org_id" uuid,
	"recipient" text NOT NULL,
	"template" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbound_emails_message" ON "outbound_emails" USING btree ("message_id");--> statement-breakpoint

-- System table, service role only. Explicit DISABLE RLS makes the intent
-- clear (default is also disabled, but stating it is defensive against future
-- migrations that flip the default).
ALTER TABLE "outbound_emails" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Same REVOKE pattern as migration 0004 — defense-in-depth against the local
-- supabase_admin default privileges that grant arwdDxtm on every new public
-- table. service_role grant inherited from migration 0003's ALTER DEFAULT
-- PRIVILEGES, no explicit GRANT needed.
REVOKE ALL ON public.outbound_emails FROM anon, authenticated;
