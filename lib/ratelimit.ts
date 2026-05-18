import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from '@/env';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// Per-route limiters. Keys passed to `rateLimit()` are scoped per-limiter via
// the `prefix` field, so the same key string never collides across surfaces.
const limiters = {
  // Webhook ingestion (Resend, eventually Stripe + Twilio). Per source+IP.
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'rl:webhook',
  }),
  // Public token-gated routes (public proposals, public docs). Phase 2 wires
  // actual issuance; limiter sits ready.
  publicDoc: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:publicDoc',
  }),
  // signIn / signUp / magic-link: per IP+email combined to defeat both
  // single-IP password spraying and single-email distributed attempts.
  // sendPasswordReset isn't wrapped yet — flagged as carryover in §35.4.
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:auth',
  }),
  // inviteTeamMember: per orgId, hourly. Tighter window since invite emails
  // generate real outbound traffic + cost.
  invite: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '1 h'),
    prefix: 'rl:invite',
  }),
  // sendMessage / editMessage: per-user global write cap. 30/min — generous
  // for genuine use, caps scripted message floods. Send and edit are kept on
  // separate budgets by key prefix (send_message:* / edit_message:*), not by
  // limiter. DEBT-021.
  message: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:message',
  }),
  // sendMessage / editMessage: per-user-per-conversation write cap. 10/min —
  // a single participant can't flood one thread. Same key-prefix split as the
  // global limiter above. DEBT-021.
  messageConversation: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:messageConversation',
  }),
} as const;

export type Limiter = keyof typeof limiters;

export interface RateLimitResult {
  limited: boolean;
  retryAfterSec: number;
}

// Returns `limited: true` when the caller has exceeded the window. The seconds
// value reflects when the window slot frees up — useful for Retry-After
// headers and user-facing copy.
export async function rateLimit(limiter: Limiter, key: string): Promise<RateLimitResult> {
  const { success, reset } = await limiters[limiter].limit(key);
  return {
    limited: !success,
    retryAfterSec: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
