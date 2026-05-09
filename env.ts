import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  RESEND_WEBHOOK_SECRET: z.string().min(1),
  // Optional: if set, used as the from-address for all outbound mail.
  // Falls back to "PCD Portal <noreply@plancraftdaily.co.uk>" (verified
  // domain, SPF/DKIM/DMARC configured in Resend). Override per-environment
  // if you want staging/preview to send from a different address.
  RESEND_FROM_ADDRESS: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  SENTRY_DSN: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  INTERNAL_CRON_SECRET: z.string().min(32),
});

export const env = schema.parse(process.env);
