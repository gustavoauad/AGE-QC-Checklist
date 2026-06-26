-- Section support for org checklist items and project checklists

-- 1. Section column on org_checklist_items
ALTER TABLE org_checklist_items ADD COLUMN IF NOT EXISTS section text;

-- 2. sort_order on checklists (project-level) for preserving push order
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;

-- 3. Sections metadata per org / category
CREATE TABLE IF NOT EXISTS org_checklist_sections (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category         text NOT NULL,
  label            text NOT NULL,
  sort_order       int  NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, category, label)
);

ALTER TABLE org_checklist_sections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'org_checklist_sections' AND policyname = 'org_members_read_sections'
  ) THEN
    CREATE POLICY "org_members_read_sections" ON org_checklist_sections
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM organization_members
          WHERE organization_members.organization_id = org_checklist_sections.organization_id
            AND organization_members.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'org_checklist_sections' AND policyname = 'org_admins_manage_sections'
  ) THEN
    CREATE POLICY "org_admins_manage_sections" ON org_checklist_sections
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM organization_members
          WHERE organization_members.organization_id = org_checklist_sections.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role = 'admin'
        )
      );
  END IF;
END $$;

-- 4. Replace push function — now carries sub_section and sort_order
CREATE OR REPLACE FUNCTION push_checklist_to_projects(
  p_project_ids  uuid[],
  p_category     text,
  p_label        text,
  p_items        jsonb,   -- [{item_id, item_text, section}]  (section may be null)
  p_action       text     -- 'overwrite_keep' | 'overwrite_reset'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  p_project_id  uuid;
  item          jsonb;
  saved_status  text;
  saved_by      uuid;
  saved_at      timestamptz;
  item_idx      int;
BEGIN
  FOREACH p_project_id IN ARRAY p_project_ids
  LOOP
    item_idx := 0;
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
        (project_id, item_id, category, item_text, status,
         completed_by, completed_at, sub_section, sort_order)
      VALUES
        (p_project_id,
         item->>'item_id',
         p_category,
         item->>'item_text',
         saved_status,
         saved_by,
         saved_at,
         NULLIF(item->>'section', ''),
         item_idx);

      item_idx := item_idx + 1;
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
