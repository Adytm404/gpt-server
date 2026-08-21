ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_region text NOT NULL DEFAULT 'Singapore (SGP)';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS log_density text NOT NULL DEFAULT 'Comfortable';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS approval_required_default boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS approval_timeout_minutes int NOT NULL DEFAULT 15;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS notify_failed_executions boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS notify_completed_executions boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS strict_host_key_checking boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS key_rotation_days int NOT NULL DEFAULT 90;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS data_retention_days int NOT NULL DEFAULT 90;

ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE users ADD COLUMN IF NOT EXISTS command_output_density text NOT NULL DEFAULT 'Detailed';
