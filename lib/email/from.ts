// Phase 1a: single from-address. Phase 5+ will read the org's verified custom
// domain (per ARCHITECTURE-saas.md §35.4 — domain verification flow). The
// org-aware signature lands then; for now this is a no-arg helper.
//
// Default sends from the verified plancraftdaily.co.uk domain. Set
// RESEND_FROM_ADDRESS to override (e.g. for staging / preview environments).
export function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? 'PCD Portal <noreply@plancraftdaily.co.uk>';
}
