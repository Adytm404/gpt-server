CREATE TABLE IF NOT EXISTS server_alert_states (
    server_id uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    last_status text NOT NULL DEFAULT 'unknown',
    consecutive_failures integer NOT NULL DEFAULT 0,
    down_since timestamptz,
    last_alert_sent_at timestamptz,
    last_resolved_sent_at timestamptz,
    last_checked_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS alert_server_down_email boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS alert_recipient_emails text NOT NULL DEFAULT '';
