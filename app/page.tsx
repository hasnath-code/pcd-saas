import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authUserHasMembership } from '@/db/queries/users';

// Root landing routes the auth user to the right surface:
//   - unauthed → /login
//   - authed, no `users` row yet → /onboarding (Session 3 signup wizard)
//   - authed, has `users` row → /dashboard
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
  redirect('/onboarding');
}
