import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { getMyOrg } from '@/db/queries/orgs';
import { getOrgSettings } from '@/db/queries/settings';
import { SETTINGS_KEYS } from '@/lib/settings/keys';
import { CompanyDetailsForm } from '@/components/settings/CompanyDetailsForm';
import { BankDetailsForm } from '@/components/settings/BankDetailsForm';
import { DefaultTermsForm } from '@/components/settings/DefaultTermsForm';

function readString(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  if (typeof v === 'string') return v;
  return '';
}

export default async function SettingsPage() {
  const authUser = await requireAuthOrRedirect();
  const myOrg = await getMyOrg(authUser.id);
  if (!myOrg) redirect('/onboarding');

  const settings = await getOrgSettings(myOrg.orgId);
  const canEdit = myOrg.role === 'owner' || myOrg.role === 'admin';

  const companyInitial = {
    name: readString(settings, SETTINGS_KEYS.companyName),
    address: readString(settings, SETTINGS_KEYS.companyAddress),
    vatNumber: readString(settings, SETTINGS_KEYS.vatNumber),
    companyNumber: readString(settings, SETTINGS_KEYS.companyNumber),
  };
  const bankInitial = {
    accountName: readString(settings, SETTINGS_KEYS.bankAccountName),
    accountNumber: readString(settings, SETTINGS_KEYS.bankAccountNumber),
    sortCode: readString(settings, SETTINGS_KEYS.bankSortCode),
  };
  const termsInitial = {
    termsAndConditions: readString(settings, SETTINGS_KEYS.termsAndConditions),
    footerText: readString(settings, SETTINGS_KEYS.footerText),
  };

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:underline">
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Manage how your firm appears on quotes, invoices, and client communications.
        </p>
        {!canEdit && (
          <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            You have read-only access. Only owners and admins can change these settings.
          </p>
        )}
      </div>

      <CompanyDetailsForm initial={companyInitial} canEdit={canEdit} />
      <BankDetailsForm initial={bankInitial} canEdit={canEdit} />
      <DefaultTermsForm initial={termsInitial} canEdit={canEdit} />

      <div className="rounded-md border p-4">
        <h2 className="text-base font-semibold">Workflows</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the stages your projects move through.
        </p>
        <Link
          href="/settings/workflows"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Manage workflows →
        </Link>
      </div>
    </main>
  );
}
