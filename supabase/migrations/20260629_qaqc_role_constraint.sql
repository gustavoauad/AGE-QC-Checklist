-- Allow 'qaqc' as a valid project member role
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('project_manager', 'engineer', 'drafter', 'qaqc'));
