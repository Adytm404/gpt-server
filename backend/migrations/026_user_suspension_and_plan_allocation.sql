ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_note text NOT NULL DEFAULT '';

ALTER TABLE workspace_subscriptions ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE TABLE IF NOT EXISTS platform_system_settings (
    id text PRIMARY KEY DEFAULT 'default',
    cron_interval_minutes integer NOT NULL DEFAULT 5 CHECK (cron_interval_minutes >= 1 AND cron_interval_minutes <= 1440),
    updated_at timestamptz NOT NULL DEFAULT now()
);
