ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 0;
ALTER TABLE token_usage DROP CONSTRAINT IF EXISTS token_usage_round_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_round_check CHECK (round >= 0);
ALTER TABLE token_usage DROP CONSTRAINT IF EXISTS token_usage_phase_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_phase_check CHECK (phase IN ('routing','planning','agent','summary','explain'));

DROP INDEX IF EXISTS token_usage_operation_phase_idx;
CREATE UNIQUE INDEX IF NOT EXISTS token_usage_operation_phase_idx ON token_usage(operation_id, phase, round) WHERE operation_id IS NOT NULL;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS agent_round integer NOT NULL DEFAULT 0;
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_agent_round_check;
ALTER TABLE operations ADD CONSTRAINT operations_agent_round_check CHECK (agent_round >= 0);
