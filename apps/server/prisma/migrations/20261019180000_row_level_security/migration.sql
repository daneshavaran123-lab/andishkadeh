-- Row-level security on every table of the schema. The server's own database user owns the tables,
-- and an owner is not restricted by RLS (no FORCE), so the server, its migrations and backups taken
-- with that user work as before. No policy is defined for any other role: another database user,
-- even one granted SELECT, sees no rows and can change none.
-- A table added by a later migration needs its own "ALTER TABLE ... ENABLE ROW LEVEL SECURITY"
-- (test/row-level-security.test.ts fails until it has it).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXCEPTION WHEN insufficient_privilege THEN
      -- a table this user does not own (set up by hand): left as it is rather than stopping the server
      RAISE WARNING 'row-level security not enabled on %: the server user does not own it', t.tablename;
    END;
  END LOOP;
END $$;
