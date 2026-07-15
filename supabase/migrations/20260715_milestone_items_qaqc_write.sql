-- The old "managers write milestone items" policy restricted INSERT/UPDATE/DELETE
-- to project_manager only, but the app's ChecklistsTab canEdit rule allows both
-- project_manager and qaqc to assign items to milestones and set days_before.
-- This mismatch caused milestone toggle/day-count writes to silently fail via RLS
-- for QAQC users (and any future non-PM role that gains item-management rights).

DROP POLICY IF EXISTS "managers write milestone items" ON milestone_items;

CREATE POLICY "pm and qaqc write milestone items" ON milestone_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM project_milestones pm
      JOIN project_members mbr ON mbr.project_id = pm.project_id
      WHERE pm.id = milestone_items.milestone_id
        AND mbr.user_id = auth.uid()
        AND mbr.role IN ('project_manager', 'qaqc')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_milestones pm
      JOIN project_members mbr ON mbr.project_id = pm.project_id
      WHERE pm.id = milestone_items.milestone_id
        AND mbr.user_id = auth.uid()
        AND mbr.role IN ('project_manager', 'qaqc')
    )
  );
