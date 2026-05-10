import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authUserHasMembership } from '@/db/queries/users';
import { authEmailHasClient } from '@/db/queries/clients';

// Root landing routes the auth user per §8:
//   - unauthed → /login
//   - has `users` row → /dashboard
//   - has only `clients` row → /portal/projects (DEBT-037 fix)
//   - neither → /onboarding (orphan auth, allow new org creation)
// Marketing pages will eventually replace this in Phase 5+.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (await authUserHasMembership(user.id)) {
    redirect('/dashboard');
  }
  if (await authEmailHasClient(user.email ?? '')) {
    redirect('/portal/projects');
  }
  redirect('/onboarding');
}
