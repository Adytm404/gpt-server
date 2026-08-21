ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_status_check;
ALTER TABLE operations ADD CONSTRAINT operations_status_check
    CHECK (status IN ('planning','pending_approval','approved','running','summarizing','succeeded','failed','rejected','cancelled'));
DROP INDEX IF EXISTS operations_one_active_per_thread_idx;
CREATE UNIQUE INDEX operations_one_active_per_thread_idx ON operations(thread_id)
    WHERE status IN ('planning','pending_approval','approved','running','summarizing');
DROP INDEX IF EXISTS operations_server_active_idx;
CREATE INDEX operations_server_active_idx ON operations(workspace_id, server_id)
    WHERE status IN ('approved','running','summarizing');

ALTER TABLE token_usage ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'planning';
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE;
ALTER TABLE token_usage DROP CONSTRAINT IF EXISTS token_usage_operation_id_key;
ALTER TABLE token_usage DROP CONSTRAINT IF EXISTS token_usage_phase_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_phase_check CHECK (phase IN ('planning','summary','explain'));
CREATE UNIQUE INDEX IF NOT EXISTS token_usage_operation_phase_idx ON token_usage(operation_id, phase) WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS token_usage_message_id_idx ON token_usage(message_id) WHERE message_id IS NOT NULL;
