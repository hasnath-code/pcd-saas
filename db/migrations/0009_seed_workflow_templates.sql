-- =============================================================================
-- Seed: "Simple" universal workflow system template (5 stages).
--
-- Hand-written data migration — pure INSERTs, no schema change. Idempotent via
-- a "skip if already exists" guard on the natural key (slug='simple' +
-- is_system_template=true). Re-running this migration on an already-seeded DB
-- is a no-op.
--
-- IDs use gen_random_uuid() (Postgres built-in). System template UUIDs don't
-- need v7 ordering — they're long-lived reference rows. Application-side
-- inserts elsewhere continue to use uuidv7() from the uuid npm package.
--
-- Per ARCHITECTURE-saas.md §13: this is the only system template seeded by
-- migration. The "PCD Surveyor" template is Hasnath-org-specific and ships
-- via scripts/seed-hasnath-pcd-surveyor.ts post-signup, not as a system
-- template.
-- =============================================================================

DO $$
DECLARE
  simple_workflow_id uuid;
BEGIN
  SELECT id INTO simple_workflow_id
  FROM public.workflows
  WHERE slug = 'simple' AND is_system_template = true;

  IF simple_workflow_id IS NULL THEN
    simple_workflow_id := gen_random_uuid();

    INSERT INTO public.workflows (
      id, org_id, org_type_id, slug, name, description,
      is_system_template, is_default, created_at
    ) VALUES (
      simple_workflow_id, NULL, NULL, 'simple', 'Simple',
      'Five-stage default workflow for any project',
      true, false, now()
    );

    INSERT INTO public.workflow_stages (
      id, workflow_id, slug, name, position, is_terminal, requires_action, color, created_at
    ) VALUES
      (gen_random_uuid(), simple_workflow_id, 'new',         'New',         1, false, false, '#94a3b8', now()),
      (gen_random_uuid(), simple_workflow_id, 'in_progress', 'In Progress', 2, false, false, '#3b82f6', now()),
      (gen_random_uuid(), simple_workflow_id, 'on_hold',     'On Hold',     3, false, false, '#f59e0b', now()),
      (gen_random_uuid(), simple_workflow_id, 'completed',   'Completed',   4, true,  false, '#10b981', now()),
      (gen_random_uuid(), simple_workflow_id, 'cancelled',   'Cancelled',   5, true,  false, '#ef4444', now());
  END IF;
END $$;
