-- Enable realtime for checklist_comments so QA/QC comments and flag/resolve changes
-- show up live for other connected users, the same way checklist status updates
-- already do. Without this, comments only appear after a manual page reload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'checklist_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE checklist_comments;
  END IF;
END $$;
