CREATE TABLE org_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  category text NOT NULL,
  item_id text NOT NULL,
  item_text text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, item_id)
);
ALTER TABLE org_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view items"  ON org_checklist_items FOR SELECT USING (organization_id IN (SELECT get_my_org_ids()));
CREATE POLICY "org admins can manage items" ON org_checklist_items FOR ALL   USING (organization_id IN (SELECT get_my_admin_org_ids()));
GRANT ALL ON org_checklist_items TO authenticated;
