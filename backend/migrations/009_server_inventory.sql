ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS operating_system text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS uptime_seconds bigint;

UPDATE servers SET operating_system = '' WHERE operating_system IS NULL;
ALTER TABLE servers
    ALTER COLUMN operating_system SET DEFAULT '',
    ALTER COLUMN operating_system SET NOT NULL;

ALTER TABLE server_health_snapshots
    ADD COLUMN IF NOT EXISTS disk_percent numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS services jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE server_health_snapshots SET disk_percent = 0 WHERE disk_percent IS NULL;
UPDATE server_health_snapshots SET services = '[]'::jsonb WHERE services IS NULL;
UPDATE server_health_snapshots SET details = '{}'::jsonb WHERE details IS NULL;
ALTER TABLE server_health_snapshots
    ALTER COLUMN disk_percent SET DEFAULT 0,
    ALTER COLUMN disk_percent SET NOT NULL,
    ALTER COLUMN services SET DEFAULT '[]'::jsonb,
    ALTER COLUMN services SET NOT NULL,
    ALTER COLUMN details SET DEFAULT '{}'::jsonb,
    ALTER COLUMN details SET NOT NULL;
