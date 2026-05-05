import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orgTypes } from '@/db/schema';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { authUserHasMembership } from '@/db/queries/users';
import { CreateOrgForm } from '@/components/onboarding/CreateOrgForm';

const ORG_TYPE_COPY = {
  surveyor: {
    title: 'Set up your surveyor firm',
    subtitle: 'A few details and you are ready to invite your team.',
  },
  architect: {
    title: 'Set up your architect firm',
    subtitle: 'A few details and you are ready to invite your team.',
  },
} as const;

type OrgTypeSlug = keyof typeof ORG_TYPE_COPY;

// Onboarding step 2: name the firm + the owner's display name. Plan picker is
// hidden in Phase 1a (Adjustment 1 of Session 3 plan) — defaults to solo_free.
export default async function OnboardingTypePage({
  params,
}: {
  params: Promise<{ orgType: string }>;
}) {
  const user = await requireAuthOrRedirect();
  if (await authUserHasMembership(user.id)) {
    redirect('/dashboard');
  }

  const { orgType: slugParam } = await params;
  const matched = await db
    .select({ slug: orgTypes.slug })
    .from(orgTypes)
    .where(eq(orgTypes.slug, slugParam))
    .limit(1);
  if (matched.length === 0 || !(matched[0].slug in ORG_TYPE_COPY)) {
    notFound();
  }
  const slug = matched[0].slug as OrgTypeSlug;
  const copy = ORG_TYPE_COPY[slug];

  return (
    <CreateOrgForm
      orgTypeSlug={slug}
      title={copy.title}
      subtitle={copy.subtitle}
    />
  );
}
