ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'ssh_key';

ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS password_ciphertext bytea;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'servers'::regclass AND conname = 'servers_auth_method_check'
    ) THEN
        ALTER TABLE servers ADD CONSTRAINT servers_auth_method_check
            CHECK (auth_method IN ('ssh_key','password'));
    END IF;
END $$;

-- Existing private-key rows retain the legacy authentication behavior.
UPDATE servers SET auth_method = 'ssh_key'
WHERE private_key_ciphertext IS NOT NULL AND auth_method <> 'ssh_key';
