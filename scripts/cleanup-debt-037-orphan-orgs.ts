import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { v7 as uuidv7 } from 'uuid';
import { eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  organizations,
  users,
  clients,
  clientOrgMemberships,
  workflows,
  workflowStages,
  projects,
  conversations,
  messages,
  projectFiles,
  auditLogs,
} from '@/db/schema';

// DEBT-037 reversible cleanup for orphan organizations spawned by the bug
// where stakeholders silently became owners of new orgs on sign-in.
//
// Reads candidates from scripts/debt-037-cleanup-candidates.json (output of
// the production query in docs/debt-037-investigation.md). Per row, in a
// Drizzle transaction (Hard Rule 19, atomic with the audit insert):
//
//   1. Pre-flight STOP if any non-zero count of projects / conversations /
//      messages / project_files exists for the org. Skip the row and log it.
//      A real Sarah-Step-2 org (legitimate dual-context owner) would have
//      started accumulating activity; this guard refuses to delete it.
//   2. Verify clients.auth_user_id matches the candidate's auth_user_id.
//      Mismatch → skip and log (manual review).
//   3. Snapshot the row to CSV (header + one line per row, written BEFORE
//      any delete so a crash mid-script preserves the audit trail).
//   4. Deletes (in FK-safe order — users.org_id RESTRICT requires users
//      first; workflows/memberships use cascade but we issue explicit
//      DELETEs so we can record counts in audit metadata):
//        a. workflow_stages WHERE workflow_id IN (workflows for this org)
//        b. workflows WHERE org_id = candidate
//        c. client_org_memberships WHERE org_id = candidate
//        d. users WHERE org_id = candidate
//        e. organizations WHERE id = candidate
//   5. Insert audit_logs row with action='system_cleanup' and metadata
//      capturing the original payloads + delete counts.
//
// Dry-run by default. Pass --apply to execute. Snapshot CSV path includes
// an ISO timestamp; pass --snapshot-dir to override.
//
// Usage:
//   npm run db:cleanup-debt-037                       # dry-run, .env.local target
//   npm run db:cleanup-debt-037 -- --apply            # execute
//   npm run db:cleanup-debt-037 -- --candidates-file=path/to.json
//   npm run db:cleanup-debt-037 -- --snapshot-dir=tmp
//
// The script targets whatever DATABASE_URL is in .env.local — verify this
// is the intended environment (likely production for a real cleanup) before
// running with --apply.

interface Candidate {
  id: string;
  name: string;
  created_at: string;
  auth_user_id: string;
  role: string;
  client_id: string;
  client_email: string;
}

interface CandidateFile {
  query_run_at: string;
  query: string;
  candidate_count: number;
  candidates: Candidate[];
  notes?: string[];
}

function parseArgs(argv: string[]): {
  apply: boolean;
  snapshotDir: string;
  candidatesFile: string;
} {
  const args = argv.slice(2);
  let apply = false;
  let snapshotDir = 'scripts';
  let candidatesFile = 'scripts/debt-037-cleanup-candidates.json';
  for (const arg of args) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--snapshot-dir=')) snapshotDir = arg.slice('--snapshot-dir='.length);
    else if (arg.startsWith('--candidates-file='))
      candidatesFile = arg.slice('--candidates-file='.length);
    else throw new Error(`unknown arg: ${arg}`);
  }
  return { apply, snapshotDir, candidatesFile };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const { apply, snapshotDir, candidatesFile } = parseArgs(process.argv);
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[cleanup-debt-037] mode=${mode} target=${process.env.DATABASE_URL?.split('@')[1] ?? '<unset>'}`);
  console.log(`[cleanup-debt-037] candidates=${candidatesFile}`);

  const file: CandidateFile = JSON.parse(readFileSync(candidatesFile, 'utf-8'));
  console.log(`[cleanup-debt-037] loaded ${file.candidate_count} candidate(s)`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = `${snapshotDir}/debt-037-cleanup-snapshot-${apply ? 'apply' : 'dryrun'}-${ts}.csv`;
  writeFileSync(
    snapshotPath,
    [
      'org_id',
      'org_name',
      'org_created_at',
      'owner_user_id',
      'auth_user_id',
      'client_id',
      'client_email',
      'projects_count',
      'conversations_count',
      'messages_count',
      'files_count',
      'action',
      'reason',
    ]
      .map(csvCell)
      .join(',') + '\n',
  );
  console.log(`[cleanup-debt-037] snapshot=${snapshotPath}`);

  const summary = {
    deleted: 0,
    skipped_activity: 0,
    skipped_link_mismatch: 0,
    skipped_clients_missing: 0,
    errored: 0,
  };

  for (const c of file.candidates) {
    console.log(`\n--- candidate org=${c.name} (id=${c.id}) owner_email=${c.client_email}`);

    let activityCounts: {
      projects: number;
      conversations: number;
      messages: number;
      files: number;
    };
    try {
      const projectRows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.orgId, c.id));
      const conversationRows = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.orgId, c.id));
      const conversationIds = conversationRows.map((r) => r.id);
      const messageRows =
        conversationIds.length > 0
          ? await db
              .select({ id: messages.id })
              .from(messages)
              .where(inArray(messages.conversationId, conversationIds))
          : [];
      const projectIds = projectRows.map((r) => r.id);
      const fileRows =
        projectIds.length > 0
          ? await db
              .select({ id: projectFiles.id })
              .from(projectFiles)
              .where(inArray(projectFiles.projectId, projectIds))
          : [];

      activityCounts = {
        projects: projectRows.length,
        conversations: conversationRows.length,
        messages: messageRows.length,
        files: fileRows.length,
      };
    } catch (e) {
      console.error(`[cleanup-debt-037] pre-flight failed for ${c.id}: ${(e as Error).message}`);
      summary.errored += 1;
      continue;
    }

    const hasActivity =
      activityCounts.projects > 0 ||
      activityCounts.conversations > 0 ||
      activityCounts.messages > 0 ||
      activityCounts.files > 0;

    const csvRow = [
      c.id,
      c.name,
      c.created_at,
      undefined, // owner_user_id — populated below if we get to the delete
      c.auth_user_id,
      c.client_id,
      c.client_email,
      activityCounts.projects,
      activityCounts.conversations,
      activityCounts.messages,
      activityCounts.files,
      undefined, // action
      undefined, // reason
    ];

    if (hasActivity) {
      console.log(
        `  SKIP — has activity (projects=${activityCounts.projects} conversations=${activityCounts.conversations} messages=${activityCounts.messages} files=${activityCounts.files}). Manual review required.`,
      );
      csvRow[11] = 'SKIP';
      csvRow[12] = 'has_activity';
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      summary.skipped_activity += 1;
      continue;
    }

    // Verify the clients link is intact (post-fix code should have backfilled).
    const clientCheck = await db
      .select({ authUserId: clients.authUserId })
      .from(clients)
      .where(eq(clients.id, c.client_id))
      .limit(1);
    if (clientCheck.length === 0) {
      console.log(`  SKIP — clients row ${c.client_id} not found.`);
      csvRow[11] = 'SKIP';
      csvRow[12] = 'clients_row_missing';
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      summary.skipped_clients_missing += 1;
      continue;
    }
    if (clientCheck[0].authUserId !== c.auth_user_id) {
      console.log(
        `  SKIP — clients.auth_user_id (${clientCheck[0].authUserId}) does not match candidate auth_user_id (${c.auth_user_id}). Manual review.`,
      );
      csvRow[11] = 'SKIP';
      csvRow[12] = 'link_mismatch';
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      summary.skipped_link_mismatch += 1;
      continue;
    }

    // Look up the owner user row + full payloads for the audit metadata.
    const orgRows = await db.select().from(organizations).where(eq(organizations.id, c.id)).limit(1);
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.orgId, c.id))
      .limit(10);
    const clientRows = await db.select().from(clients).where(eq(clients.id, c.client_id)).limit(1);
    const ownerUserRow = userRows.find((u) => u.role === 'owner') ?? userRows[0];
    csvRow[3] = ownerUserRow?.id;

    if (!apply) {
      console.log(
        `  WOULD DELETE — org=${c.name} (id=${c.id}) zero-activity. Run with --apply to execute.`,
      );
      csvRow[11] = 'WOULD_DELETE';
      csvRow[12] = 'dry_run';
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      continue;
    }

    // --apply: execute the deletion + audit in one transaction.
    try {
      await db.transaction(async (tx) => {
        const wfRows = await tx
          .select({ id: workflows.id })
          .from(workflows)
          .where(eq(workflows.orgId, c.id));
        const wfIds = wfRows.map((r) => r.id);

        let stagesDeleted = 0;
        if (wfIds.length > 0) {
          const stageDel = await tx
            .delete(workflowStages)
            .where(inArray(workflowStages.workflowId, wfIds))
            .returning({ id: workflowStages.id });
          stagesDeleted = stageDel.length;
        }

        const wfDel = await tx
          .delete(workflows)
          .where(eq(workflows.orgId, c.id))
          .returning({ id: workflows.id });

        const memDel = await tx
          .delete(clientOrgMemberships)
          .where(eq(clientOrgMemberships.orgId, c.id))
          .returning({ id: clientOrgMemberships.id });

        const usrDel = await tx
          .delete(users)
          .where(eq(users.orgId, c.id))
          .returning({ id: users.id });

        const orgDel = await tx
          .delete(organizations)
          .where(eq(organizations.id, c.id))
          .returning({ id: organizations.id });

        if (orgDel.length === 0) {
          throw new Error(`organizations row ${c.id} unexpectedly missing during delete`);
        }

        await tx.insert(auditLogs).values({
          id: uuidv7(),
          orgId: undefined, // org just deleted; setting to NULL deliberately
          userId: undefined,
          clientId: c.client_id,
          action: 'system_cleanup',
          resourceType: 'organization',
          resourceId: c.id,
          metadata: {
            event: 'cleanup.debt_037',
            dry_run: false,
            org_payload: orgRows[0],
            user_payload: ownerUserRow,
            client_payload: clientRows[0],
            deleted_workflows: wfDel.length,
            deleted_workflow_stages: stagesDeleted,
            deleted_memberships: memDel.length,
            deleted_users: usrDel.length,
            reason: 'orphan org spawned by stakeholder sign-in',
          },
        });
      });

      console.log(`  DELETED — org=${c.name} (id=${c.id}). Audit row written.`);
      csvRow[11] = 'DELETED';
      csvRow[12] = 'orphan_org_cleanup';
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      summary.deleted += 1;
    } catch (e) {
      console.error(`  ERROR — ${c.id}: ${(e as Error).message}`);
      csvRow[11] = 'ERROR';
      csvRow[12] = (e as Error).message.slice(0, 200);
      appendFileSync(snapshotPath, csvRow.map(csvCell).join(',') + '\n');
      summary.errored += 1;
    }
  }

  console.log('\n[cleanup-debt-037] summary:');
  console.log(`  ${apply ? 'deleted' : 'would delete'}: ${summary.deleted}`);
  console.log(`  skipped (has activity):    ${summary.skipped_activity}`);
  console.log(`  skipped (link mismatch):   ${summary.skipped_link_mismatch}`);
  console.log(`  skipped (clients missing): ${summary.skipped_clients_missing}`);
  console.log(`  errored:                   ${summary.errored}`);
  console.log(`[cleanup-debt-037] snapshot written to ${snapshotPath}`);
  if (!apply) {
    console.log('[cleanup-debt-037] DRY-RUN complete. Re-run with --apply to execute.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[cleanup-debt-037] fatal:', e);
    process.exit(1);
  });
