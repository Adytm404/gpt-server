ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS operation_id uuid;

UPDATE chat_messages cm
SET operation_id = tu.operation_id
FROM token_usage tu
WHERE tu.message_id = cm.id
  AND tu.operation_id IS NOT NULL
  AND tu.phase IN ('planning','summary')
  AND cm.operation_id IS DISTINCT FROM tu.operation_id;

UPDATE chat_messages cm
SET operation_id = e.operation_id
FROM operation_events e
WHERE e.event_type = 'planning'
  AND e.payload ? 'message_id'
  AND (e.payload->>'message_id')::uuid = cm.id
  AND cm.operation_id IS DISTINCT FROM e.operation_id;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_operation_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_operation_id_fkey
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_messages_thread_operation_created_idx ON chat_messages(thread_id, operation_id, created_at);
