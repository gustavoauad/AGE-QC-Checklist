-- ── Organizations ─────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ── Organization members ───────────────────────────────────────────────────
CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  invited_by uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ── Org-level default checklist config ────────────────────────────────────
CREATE TABLE org_checklist_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  category text NOT NULL,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(organization_id, category)
);
ALTER TABLE org_checklist_config ENABLE ROW LEVEL SECURITY;

-- ── Add org + archive columns to projects ─────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── Security-definer helpers (avoid recursive RLS) ────────────────────────
CREATE OR REPLACE FUNCTION get_my_org_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_my_admin_org_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin';
$$;

-- ── Organizations RLS ──────────────────────────────────────────────────────
CREATE POLICY "org members can view"      ON organizations FOR SELECT USING (id IN (SELECT get_my_org_ids()));
CREATE POLICY "org admins can update"     ON organizations FOR UPDATE USING (id IN (SELECT get_my_admin_org_ids()));
CREATE POLICY "authenticated can create"  ON organizations FOR INSERT WITH CHECK (auth.uid() = created_by);
GRANT ALL ON organizations TO authenticated;

-- ── Organization members RLS ───────────────────────────────────────────────
CREATE POLICY "members can view org members"   ON organization_members FOR SELECT USING (organization_id IN (SELECT get_my_org_ids()));
CREATE POLICY "insert own or admin inserts"    ON organization_members FOR INSERT WITH CHECK (auth.uid() = user_id OR organization_id IN (SELECT get_my_admin_org_ids()));
CREATE POLICY "org admins can update members"  ON organization_members FOR UPDATE USING (organization_id IN (SELECT get_my_admin_org_ids()));
CREATE POLICY "org admins can delete members"  ON organization_members FOR DELETE USING (organization_id IN (SELECT get_my_admin_org_ids()));
GRANT ALL ON organization_members TO authenticated;

-- ── Org checklist config RLS ──────────────────────────────────────────────
CREATE POLICY "org members can view config"   ON org_checklist_config FOR SELECT USING (organization_id IN (SELECT get_my_org_ids()));
CREATE POLICY "org admins can manage config"  ON org_checklist_config FOR ALL USING (organization_id IN (SELECT get_my_admin_org_ids()));
GRANT ALL ON org_checklist_config TO authenticated;

-- ── Projects: org members can view all projects in their org ──────────────
-- (Access to checklist data is still gated by project_members RLS)
CREATE POLICY "org members view org projects" ON projects
  FOR SELECT USING (organization_id IN (SELECT get_my_org_ids()));

-- ── Realtime ──────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE organizations;
ALTER PUBLICATION supabase_realtime ADD TABLE organization_members;
