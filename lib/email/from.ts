// Phase 1a: single from-address. Phase 5+ will read the org's verified custom
// domain (per ARCHITECTURE-saas.md §35.4 — domain verification flow). The
// org-aware signature lands then; for now this is a no-arg helper.
//
// Default falls back to Resend's onboarding sender, which works without
// domain verification and is fine for dev / small sends. Production sends
// should set RESEND_FROM_ADDRESS to a verified-domain address.
export function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? 'PCD Portal <onboarding@resend.dev>';
}
