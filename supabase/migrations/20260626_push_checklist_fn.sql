-- Security-definer function so org admins can push checklists to any project
-- in their org, even if they are not a project member.
CREATE OR REPLACE FUNCTION push_checklist_to_project(
  p_project_id   uuid,
  p_category     text,
  p_label        text,
  p_items        jsonb,
  p_action       text,        -- 'overwrite_keep' | 'overwrite_reset' | 'new'
  p_new_cat_id   text  DEFAULT NULL,
  p_new_cat_label text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item          jsonb;
  saved_status  text;
  saved_by      uuid;
  saved_at      timestamptz;
  target_cat    text;
  new_item_id   text;
BEGIN
  IF p_action = 'new' THEN
    target_cat := p_new_cat_id;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      new_item_id := target_cat || '_' || (item->>'item_id');
      INSERT INTO checklists
        (project_id, item_id, category, item_text, status, is_custom)
      VALUES
        (p_project_id, new_item_id, target_cat,
         item->>'item_text', 'pending', true)
      ON CONFLICT DO NOTHING;
    END LOOP;

    INSERT INTO project_checklist_config (project_id, category, enabled, label)
    VALUES (p_project_id, target_cat, true, p_new_cat_label)
    ON CONFLICT (project_id, category)
    DO UPDATE SET enabled = true, label = p_new_cat_label;

  ELSE
    -- overwrite_keep OR overwrite_reset
    target_cat := p_category;

    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      saved_status := 'pending';
      saved_by     := NULL;
      saved_at     := NULL;

      IF p_action = 'overwrite_keep' THEN
        SELECT status, completed_by, completed_at
          INTO saved_status, saved_by, saved_at
          FROM checklists
         WHERE project_id = p_project_id
           AND item_id = (item->>'item_id')
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
        (p_project_id, item->>'item_id', target_cat,
         item->>'item_text', saved_status, saved_by, saved_at);
    END LOOP;

    -- Remove old items for this category that are no longer in the org list
    DELETE FROM checklists
     WHERE project_id = p_project_id
       AND category   = target_cat
       AND item_id NOT IN (
         SELECT value->>'item_id' FROM jsonb_array_elements(p_items)
       );

    INSERT INTO project_checklist_config (project_id, category, enabled, label)
    VALUES (p_project_id, target_cat, true, p_label)
    ON CONFLICT (project_id, category)
    DO UPDATE SET enabled = true, label = p_label;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION push_checklist_to_project TO authenticated;
