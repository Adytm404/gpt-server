-- Keep legacy audit columns compatible with platform-scoped atomic audit inserts.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='audit_events' AND column_name='target_type'
    ) THEN
        UPDATE audit_events SET target_type='platform' WHERE target_type IS NULL OR target_type='';
        ALTER TABLE audit_events ALTER COLUMN target_type SET DEFAULT 'platform';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='audit_events' AND column_name='request_id'
    ) THEN
        ALTER TABLE audit_events ALTER COLUMN request_id DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='audit_events' AND column_name='ip_address'
    ) THEN
        ALTER TABLE audit_events ALTER COLUMN ip_address DROP NOT NULL;
    END IF;
END $$;
