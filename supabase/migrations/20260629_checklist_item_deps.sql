-- Project-level checklist item dependencies
-- item_id "depends on" depends_on_item_id (must complete parent first)
CREATE TABLE IF NOT EXISTS checklist_item_dependencies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  depends_on_item_id  uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id, depends_on_item_id),
  CHECK(item_id != depends_on_item_id)
);

-- Org template-level dependencies (carried as reference; enforced at project level)
CREATE TABLE IF NOT EXISTS org_checklist_item_dependencies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  item_id             uuid NOT NULL,
  depends_on_item_id  uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, item_id, depends_on_item_id),
  CHECK(item_id != depends_on_item_id)
);
