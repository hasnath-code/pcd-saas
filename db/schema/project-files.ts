import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';

// Phase 1c §12.4. A file uploaded to a project. uploaded_by_type/_id is the
// polymorphic FK (user OR client). storage_path is the canonical key inside
// the 'org-files' bucket — the application code, not the DB, computes the
// path as: org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext} where
// subdir maps from `source` (surveyor_upload → surveyor-uploads,
// client_upload → client-uploads, document_artifact → documents). The
// storage RLS in 0019 reads this path via storage.foldername(name) — keep
// the on-disk shape in lockstep with both the table column and the policies.
//
// `visibility` (per spec §12.4): 'org_only' hides the row from stakeholders
// even when can_view_drawings = true. 'org_and_stakeholders' (default) lets
// the project_files SELECT policy's stakeholder branch apply.
//
// `thumbnail_path` (added Session 10): nullable column reserved for a future
// preview-generation pipeline. Session 10 ships file uploads WITHOUT
// thumbnail/preview generation (descoped — see DEBT-032 for the full
// diagnosis: pdf-poppler native-deps risk on Vercel + new async-pipeline
// infrastructure cost). Keeping the column nullable means previews can land
// in a follow-up session without a migration.
//
// Soft-delete via deleted_at. Per-command RLS in 0018 — SELECT filters
// deleted_at IS NULL; INSERT splits org-member vs stakeholder branches;
// UPDATE allows uploader self-soft-delete + admin restore; DELETE is
// org-admin-only (recovery path). Reuses auth_user_stakeholder_project_visibility()
// from 0010 for the stakeholder branch — no new helper needed.
export const projectFiles = pgTable(
  'project_files',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadedByType: text('uploaded_by_type').notNull(),
    uploadedById: uuid('uploaded_by_id').notNull(),
    storagePath: text('storage_path').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    visibility: text('visibility').notNull().default('org_and_stakeholders'),
    thumbnailPath: text('thumbnail_path'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'project_files_uploaded_by_type_check',
      sql`uploaded_by_type IN ('user', 'client')`,
    ),
    check(
      'project_files_source_check',
      sql`source IN ('surveyor_upload', 'client_upload', 'document_artifact')`,
    ),
    check(
      'project_files_visibility_check',
      sql`visibility IN ('org_only', 'org_and_stakeholders')`,
    ),
    check('project_files_size_bytes_positive', sql`size_bytes >= 0`),
    index('idx_project_files_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
  ],
);
