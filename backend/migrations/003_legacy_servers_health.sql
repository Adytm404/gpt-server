-- Repair constraints left by the pre-versioned server experiment without deleting legacy data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'servers' AND column_name = 'encrypted_private_key'
    ) THEN
        ALTER TABLE servers ALTER COLUMN encrypted_private_key DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'servers' AND column_name = 'metadata'
    ) THEN
        UPDATE servers SET metadata = '{}'::jsonb WHERE metadata IS NULL;
        ALTER TABLE servers ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'servers' AND column_name = 'username'
    ) THEN
        UPDATE servers SET ssh_user = username WHERE (ssh_user IS NULL OR ssh_user = '') AND username IS NOT NULL;
        ALTER TABLE servers ALTER COLUMN username DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS disk_percent numeric NOT NULL DEFAULT 0;
