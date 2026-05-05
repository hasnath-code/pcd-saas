import { redirect } from 'next/navigation';
import { db } from '@/db';
import { orgTypes } from '@/db/schema';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { authUserHasMembership } from '@/db/queries/users';
import { OrgTypePicker } from '@/components/onboarding/OrgTypePicker';

// Onboarding step 1: pick the firm type. If the auth user already has a `users`
// row, bounce them to /dashboard (no second-org setup in Phase 1a).
export default async function OnboardingStartPage() {
  const user = await requireAuthOrRedirect();
  if (await authUserHasMembership(user.id)) {
    redirect('/dashboard');
  }

  const types = await db
    .select({
      slug: orgTypes.slug,
      name: orgTypes.name,
    })
    .from(orgTypes)
    .orderBy(orgTypes.slug);

  return <OrgTypePicker orgTypes={types} />;
}
