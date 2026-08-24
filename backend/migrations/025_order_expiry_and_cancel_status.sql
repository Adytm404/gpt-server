DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workspace_orders_status_check'
    ) THEN
        ALTER TABLE workspace_orders DROP CONSTRAINT workspace_orders_status_check;
    END IF;
END $$;

ALTER TABLE workspace_orders
    ADD CONSTRAINT workspace_orders_status_check
    CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'cancelled', 'canceled'));
