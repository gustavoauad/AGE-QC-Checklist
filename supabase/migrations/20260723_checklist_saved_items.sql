-- Backs the new "To-Do" ribbon: lets a user bookmark ("Save Item") a checklist
-- item to a personal list. Private by design — RLS restricts every row to its
-- own user_id, with no project-membership carve-out, since this list must never
-- be visible to (or affected by) any other user, including other members of the
-- same project.
CREATE TABLE IF NOT EXISTS checklist_saved_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checklist_item_id  uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checklist_item_id)
);

ALTER TABLE checklist_saved_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own saved items" ON checklist_saved_items;
CREATE POLICY "users manage own saved items" ON checklist_saved_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_saved_items TO authenticated;
