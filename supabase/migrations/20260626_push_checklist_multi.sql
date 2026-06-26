-- Replaces single-project function with a multi-project version.
-- "Add as New" is removed; action is always overwrite_keep or overwrite_reset.
-- Projects with no existing items for the category simply get the items inserted.
CREATE OR REPLACE FUNCTION push_checklist_to_projects(
  p_project_ids  uuid[],
  p_category     text,
  p_label        text,
  p_items        jsonb,
  p_action       text     -- 'overwrite_keep' | 'overwrite_reset'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  p_project_id  uuid;
  item          jsonb;
  saved_status  text;
  saved_by      uuid;
  saved_at      timestamptz;
BEGIN
  FOREACH p_project_id IN ARRAY p_project_ids
  LOOP
    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      saved_status := 'pending'; saved_by := NULL; saved_at := NULL;

      IF p_action = 'overwrite_keep' THEN
        SELECT status, completed_by, completed_at
          INTO saved_status, saved_by, saved_at
          FROM checklists
         WHERE project_id = p_project_id
           AND item_id    = (item->>'item_id')
         LIMIT 1;
        IF NOT FOUND THEN
          saved_status := 'pending'; saved_by := NULL; saved_at := NULL;
        END IF;
      END IF;

      DELETE FROM checklists
       WHERE project_id = p_project_id
         AND item_id    = (item->>'item_id');

      INSERT INTO checklists
        (project_id, item_id, category, item_text, status, completed_by, completed_at)
      VALUES
        (p_project_id, item->>'item_id', p_category,
         item->>'item_text', saved_status, saved_by, saved_at);
    END LOOP;

    -- Remove items in this category no longer in the org list
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
