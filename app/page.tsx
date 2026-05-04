import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Root landing: ship users straight to /dashboard if signed in, else /login.
// Marketing pages will eventually replace this in Phase 5+.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? '/dashboard' : '/login');
}
