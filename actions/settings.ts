'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AuthError,
  requireOrgAdmin,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { orgSettings } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { SETTINGS_KEYS } from '@/lib/settings/keys';

export type ServerActionResult =
  | { success: true }
  | { error: ServerActionErrorCode; reason?: string };

// Stores the value as JSON. Empty / undefined string clears the slot to null
// (preserves audit-trail of "was set, then cleared"; soft-delete is reserved
// for the row-removal pattern §23 where someone explicitly tombstones a key).
async function upsertSetting(orgId: string, key: string, value: string | null) {
  const existing = await db
    .select({ id: orgSettings.id })
    .from(orgSettings)
    .where(
      and(
        eq(orgSettings.orgId, orgId),
        eq(orgSettings.key, key),
        isNull(orgSettings.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(orgSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(orgSettings.id, existing[0].id));
  } else {
    await db.insert(orgSettings).values({
      id: uuidv7(),
      orgId,
      key,
      value,
    });
  }
}

function normalizeOptional(input: string | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function handleAdminAction<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  fn: (
    parsed: T,
    ctx: Awaited<ReturnType<typeof requireOrgAdmin>>,
  ) => Promise<void>,
): Promise<ServerActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  try {
    await fn(parsed.data, ctx);
    return { success: true };
  } catch (e) {
    if (e instanceof Error) {
      return { error: 'internal_error', reason: e.message };
    }
    throw e;
  }
}

const CompanyDetailsInput = z.object({
  name: z.string().max(120).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  vatNumber: z
    .string()
    .max(20)
    .optional()
    .nullable()
    .refine(
      (v) => v == null || v.trim() === '' || /^[A-Za-z0-9 ]+$/.test(v),
      'VAT number can only contain letters, numbers, and spaces',
    ),
  companyNumber: z
    .string()
    .max(20)
    .optional()
    .nullable()
    .refine(
      (v) => v == null || v.trim() === '' || /^[A-Za-z0-9]+$/.test(v),
      'Companies House number can only contain letters and numbers',
    ),
});

export async function updateCompanyDetails(input: unknown): Promise<ServerActionResult> {
  return handleAdminAction(CompanyDetailsInput, input, async (data, ctx) => {
    const updated: string[] = [];
    const inputMap = {
      [SETTINGS_KEYS.companyName]: 'name' as const,
      [SETTINGS_KEYS.companyAddress]: 'address' as const,
      [SETTINGS_KEYS.vatNumber]: 'vatNumber' as const,
      [SETTINGS_KEYS.companyNumber]: 'companyNumber' as const,
    };
    for (const [key, field] of Object.entries(inputMap)) {
      if (data[field] === undefined) continue;
      await upsertSetting(ctx.orgId, key, normalizeOptional(data[field]));
      updated.push(key);
    }
    if (updated.length === 0) return;
    await logAudit({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: 'update',
      resourceType: 'org_settings',
      metadata: { keys_updated: updated, section: 'company' },
    });
  });
}

const BankDetailsInput = z.object({
  accountName: z.string().max(120).optional().nullable(),
  accountNumber: z
    .string()
    .max(20)
    .optional()
    .nullable()
    .refine(
      (v) => v == null || v.trim() === '' || /^\d{6,12}$/.test(v.replace(/\s+/g, '')),
      'Account number must be 6–12 digits',
    ),
  sortCode: z
    .string()
    .max(10)
    .optional()
    .nullable()
    .refine(
      (v) =>
        v == null || v.trim() === '' || /^\d{2}-?\d{2}-?\d{2}$/.test(v.replace(/\s+/g, '')),
      'Sort code must be 6 digits, optionally split as 12-34-56',
    ),
});

export async function updateBankDetails(input: unknown): Promise<ServerActionResult> {
  return handleAdminAction(BankDetailsInput, input, async (data, ctx) => {
    const updated: string[] = [];
    const inputMap = {
      [SETTINGS_KEYS.bankAccountName]: 'accountName' as const,
      [SETTINGS_KEYS.bankAccountNumber]: 'accountNumber' as const,
      [SETTINGS_KEYS.bankSortCode]: 'sortCode' as const,
    };
    for (const [key, field] of Object.entries(inputMap)) {
      if (data[field] === undefined) continue;
      await upsertSetting(ctx.orgId, key, normalizeOptional(data[field]));
      updated.push(key);
    }
    if (updated.length === 0) return;
    await logAudit({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: 'update',
      resourceType: 'org_settings',
      metadata: { keys_updated: updated, section: 'bank' },
    });
  });
}

const DefaultTermsInput = z.object({
  termsAndConditions: z.string().max(10_000).optional().nullable(),
  footerText: z.string().max(500).optional().nullable(),
});

export async function updateDefaultTerms(input: unknown): Promise<ServerActionResult> {
  return handleAdminAction(DefaultTermsInput, input, async (data, ctx) => {
    const updated: string[] = [];
    const inputMap = {
      [SETTINGS_KEYS.termsAndConditions]: 'termsAndConditions' as const,
      [SETTINGS_KEYS.footerText]: 'footerText' as const,
    };
    for (const [key, field] of Object.entries(inputMap)) {
      if (data[field] === undefined) continue;
      await upsertSetting(ctx.orgId, key, normalizeOptional(data[field]));
      updated.push(key);
    }
    if (updated.length === 0) return;
    await logAudit({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: 'update',
      resourceType: 'org_settings',
      metadata: { keys_updated: updated, section: 'terms' },
    });
  });
}
