-- push_checklist_to_projects was broken by a direct hand-edit to the live database
-- (never captured in a migration) that added an org-admin permission check but
-- replaced the entire function body with a placeholder comment instead of the
-- real logic. Because CREATE OR REPLACE FUNCTION fully replaces the body (it does
-- not merge), every "Push to Project" since that edit has run the permission
-- check, done nothing else, and returned success — so pushes silently no-op.
--
-- While restoring the body, two more real bugs are fixed:
--
-- 1. The old body DELETEd each checklist row and re-INSERTed it, even for
--    "overwrite_keep". checklists.id is referenced by milestone_items,
--    checklist_comments, and checklist_item_dependencies, all ON DELETE CASCADE
--    — so every push (including "keep") silently wiped milestone assignments/
--    due-dates, comments, and dependencies for every item in the category. There
--    is already a UNIQUE (project_id, item_id) constraint, so this now does a
--    real UPSERT that keeps the row's id (and everything hanging off it) stable.
--
-- 2. "overwrite_keep" preserved status/completed_by/completed_at but not
--    in_progress_by/in_progress_at, so an in-progress item kept its "In Progress"
--    pill but lost who/when after a push. Now preserved too.
CREATE OR REPLACE FUNCTION public.push_checklist_to_projects(
  p_project_ids  uuid[],
  p_category     text,
  p_label        text,
  p_items        jsonb,   -- [{item_id, item_text, section, help_text, days_before_milestone}]
  p_action       text     -- 'overwrite_keep' | 'overwrite_reset'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  p_project_id  uuid;
  item          jsonb;
  item_idx      int;
BEGIN
  -- Verify caller is an org admin for every target project.
  IF EXISTS (
    SELECT 1 FROM unnest(p_project_ids) AS pid
    WHERE pid NOT IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid() AND om.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'permission denied: not an org admin for one or more target projects';
  END IF;

  FOREACH p_project_id IN ARRAY p_project_ids
  LOOP
    item_idx := 0;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO checklists
        (project_id, item_id, category, item_text, status,
         completed_by, completed_at, in_progress_by, in_progress_at,
         sub_section, sort_order, help_text, days_before_milestone)
      VALUES
        (p_project_id,
         item->>'item_id',
         p_category,
         item->>'item_text',
         'pending', NULL, NULL, NULL, NULL,
         NULLIF(item->>'section', ''),
         item_idx,
         NULLIF(item->>'help_text', ''),
         (item->>'days_before_milestone')::int)
      ON CONFLICT (project_id, item_id) DO UPDATE SET
        category               = EXCLUDED.category,
        item_text               = EXCLUDED.item_text,
        sub_section             = EXCLUDED.sub_section,
        sort_order               = EXCLUDED.sort_order,
        help_text               = EXCLUDED.help_text,
        days_before_milestone   = EXCLUDED.days_before_milestone,
        status         = CASE WHEN p_action = 'overwrite_keep' THEN checklists.status         ELSE 'pending' END,
        completed_by   = CASE WHEN p_action = 'overwrite_keep' THEN checklists.completed_by   ELSE NULL END,
        completed_at   = CASE WHEN p_action = 'overwrite_keep' THEN checklists.completed_at   ELSE NULL END,
        in_progress_by = CASE WHEN p_action = 'overwrite_keep' THEN checklists.in_progress_by ELSE NULL END,
        in_progress_at = CASE WHEN p_action = 'overwrite_keep' THEN checklists.in_progress_at ELSE NULL END;

      item_idx := item_idx + 1;
    END LOOP;

    -- Remove items in this category no longer in the org list (legitimately
    -- deletes their milestone assignments/comments/dependencies along with them).
    DELETE FROM checklists
     WHERE project_id = p_project_id
       AND category   = p_category
       AND item_id NOT IN (
         SELECT value->>'item_id' FROM jsonb_array_elements(p_items)
       );

    INSERT INTO project_checklist_config (project_id, category, enabled, label)
    VALUES (p_project_id, p_category, true, p_label)
    ON CONFLICT (project_id, category)
    DO UPDATE SET enabled = true, label = p_label;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION push_checklist_to_projects(uuid[], text, text, jsonb, text) TO authenticated;
