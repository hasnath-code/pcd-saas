'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// DEBT-025: client-side counterpart to the server scope set in the auth
// helpers (lib/auth/requireAuth.ts). Effect-only — renders nothing. Each
// layout resolves the identity server-side and passes it as props; the effect
// mirrors it onto the browser Sentry scope so client-side errors carry the
// same user / org attribution as server-side ones.
//
// The browser Sentry init (instrumentation-client.ts) only activates when
// NEXT_PUBLIC_SENTRY_DSN is set; until then these calls are safe no-ops.
export function SentryScope({
  userId,
  email,
  orgId,
  participantType,
}: {
  userId: string;
  email?: string;
  orgId?: string;
  participantType: 'user' | 'client';
}) {
  useEffect(() => {
    Sentry.setUser({ id: userId, email });
    Sentry.setTag('participant_type', participantType);
    if (orgId) Sentry.setTag('org_id', orgId);
  }, [userId, email, orgId, participantType]);

  return null;
}
