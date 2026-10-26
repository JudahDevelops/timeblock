-- Google Calendar sync is gone. Stop the two pg_cron jobs that drove it first,
-- or they keep calling /api/sync/* every five minutes and getting 404s back.
-- Guarded so this still applies to a database that never had pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('timeblock-sync', 'timeblock-renew-channels');
  END IF;
END $$;--> statement-breakpoint
-- Imported events stay, bodies and all, but nothing owns them on Google's side
-- any more, so they become ordinary editable blocks.
UPDATE "events" SET "origin" = 'local' WHERE "origin" = 'google';--> statement-breakpoint
DROP TABLE IF EXISTS "calendar_connections" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "event_links" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "google_accounts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sync_conflicts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sync_jobs" CASCADE;
