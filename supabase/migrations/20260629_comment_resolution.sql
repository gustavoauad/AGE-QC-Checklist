-- Allow QAQC-flagged comments to be resolved directly from the dashboard
ALTER TABLE checklist_comments
  ADD COLUMN IF NOT EXISTS is_resolved  boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by  uuid       REFERENCES auth.users(id);
