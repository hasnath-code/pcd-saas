-- =============================================================================
-- Replace the auth_user_stakeholder_projects() stub from migration 0001 with
-- the real implementation. Returns the project_ids where the current auth user
-- is an accepted, non-deleted stakeholder. Signature unchanged; the existing
-- caller (projects_select_org_or_stakeholder policy in 0008) automatically
-- gains stakeholder visibility.
--
-- Mirrors how 0007 unstubbed auth_user_stakeholder_orgs(). Until this migration
-- ran, only org members could see projects; stakeholders never could (correct
-- behavior for Sessions 1–5, since project_stakeholders didn't exist).
--
-- search_path is pinned per the Phase 1a helper convention (0001 + 0007 + 0010).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_stakeholder_projects()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT ps.project_id
  FROM public.project_stakeholders ps
  JOIN public.clients c ON c.id = ps.client_id
  WHERE c.auth_user_id = auth.uid()
    AND c.deleted_at IS NULL
    AND ps.deleted_at IS NULL
    AND ps.accepted_at IS NOT NULL;
$$;
