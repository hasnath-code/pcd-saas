-- =============================================================================
-- Replace the auth_user_conversation_ids() stub from migration 0014 with the
-- real implementation. Returns the conversation_ids where the current auth
-- user is an active participant — either as an org user (matched via users)
-- or as a stakeholder (matched via clients). Soft-leave (left_at) is
-- filtered out so removed participants stop seeing the conversation
-- immediately.
--
-- Mirrors how 0013 unstubbed auth_user_stakeholder_projects() once
-- project_stakeholders existed. Until this migration ran:
--   - Org members still saw all org conversations (via is_org_member branch).
--   - Stakeholders saw nothing (the helper returned empty), which is the
--     correct conservative behavior pre-Session-9.
-- After this migration: stakeholders see conversations they participate in,
-- and the helper also enables the messages_insert_participants gate.
--
-- SECURITY DEFINER + pinned search_path: see Session 7 §35.7 entry 7
-- (regression-tested in tests/rls/security-boundary.test.ts via pg_proc).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT cp.conversation_id
  FROM public.conversation_participants cp
  JOIN public.users u
    ON u.id = cp.participant_id
   AND cp.participant_type = 'user'
  WHERE u.auth_user_id = auth.uid()
    AND u.deleted_at IS NULL
    AND cp.left_at IS NULL
  UNION
  SELECT cp.conversation_id
  FROM public.conversation_participants cp
  JOIN public.clients c
    ON c.id = cp.participant_id
   AND cp.participant_type = 'client'
  WHERE c.auth_user_id = auth.uid()
    AND c.deleted_at IS NULL
    AND cp.left_at IS NULL;
$$;
