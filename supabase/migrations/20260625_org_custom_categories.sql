ALTER TABLE org_checklist_config ADD COLUMN IF NOT EXISTS is_custom boolean DEFAULT false;
ALTER TABLE org_checklist_config ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;
