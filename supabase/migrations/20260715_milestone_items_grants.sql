-- milestone_items had RLS policies but was missing table-level GRANTs for the
-- authenticated role. RLS policies only restrict which rows a role can touch —
-- the role still needs the underlying SQL privilege (INSERT/UPDATE/DELETE/SELECT)
-- on the table itself. Without it, every UPDATE and upsert (which does an
-- INSERT ... ON CONFLICT DO UPDATE) fails with "permission denied for table
-- milestone_items" (42501), which is what caused milestone toggles and
-- days_before edits to silently fail from the app.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestone_items TO authenticated;
