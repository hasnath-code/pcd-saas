import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';

// Audit-log standard actions per ARCHITECTURE-saas.md §22 + §10.7.
// audit_logs.action has no SQL CHECK; the type below is the agreement.
export type AuditAction =
  | 'create'
  | 'update'
  | 'soft_delete'
  | 'restore'
  // Session 8: hard delete for tables that don't carry deleted_at (e.g.
  // workflow_stages — stages don't have history independent of their parent).
  | 'delete'
  // Session 8: project current_stage_id transition. Metadata locks the schema
  // for forward-compatibility with the Phase 1c notification dispatch
  // (project_activity table reads from this same metadata shape — see
  // ARCHITECTURE-saas.md §12.7 + Session 8 plan Hard Rule 8).
  | 'stage_changed'
  | 'permission_change'
  | 'invite_sent'
  | 'invite_accepted'
  | 'login'
  | 'password_changed'
  // Session 5: scripts/* operations that aren't user-initiated soft-deletes
  // (e.g. one-shot cleanup of stub rows after a system migration).
  | 'system_cleanup';

export type LogAuditOpts = {
  orgId?: string;
  userId?: string;
  // Phase 1b adds clients table; the column is here in 1a as a forward-compat hook.
  clientId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

// Append-only audit row insert. Bypasses RLS via the pooler `db` client (postgres
// role); audit_logs has no INSERT policy for authenticated users by design.
//
// Throws on insert failure — callers in server actions should let this propagate
// after the business mutation completes; the audit gap should surface in Sentry.
//
// Adds a Sentry breadcrumb with the action + resource type (no metadata, since
// metadata may contain sensitive values).
export async function logAudit(opts: LogAuditOpts): Promise<void> {
  const id = uuidv7();
  await db.insert(auditLogs).values({
    id,
    orgId: opts.orgId,
    userId: opts.userId,
    clientId: opts.clientId,
    action: opts.action,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    metadata: opts.metadata ?? {},
    ip: opts.ip,
    userAgent: opts.userAgent,
  });

  Sentry.addBreadcrumb({
    category: 'audit',
    type: 'info',
    level: 'info',
    message: `${opts.action} ${opts.resourceType}`,
    data: {
      auditId: id,
      orgId: opts.orgId,
      resourceId: opts.resourceId,
    },
  });
}
