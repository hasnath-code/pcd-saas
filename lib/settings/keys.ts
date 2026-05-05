// Canonical org_settings.key strings. Listed here so a typo in one place
// doesn't silently store the value at a different key from where the form
// reads it. Pure constants — kept out of `actions/settings.ts` because
// 'use server' files can only export async functions.
export const SETTINGS_KEYS = {
  // Company
  companyName: 'company.name',
  companyAddress: 'company.address',
  vatNumber: 'company.vat_number',
  companyNumber: 'company.company_number',
  // Bank
  bankAccountName: 'bank.account_name',
  bankAccountNumber: 'bank.account_number',
  bankSortCode: 'bank.sort_code',
  // Terms
  termsAndConditions: 'terms.terms_and_conditions',
  footerText: 'terms.footer_text',
} as const;
