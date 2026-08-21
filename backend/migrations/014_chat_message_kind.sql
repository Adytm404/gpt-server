ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat';

UPDATE chat_messages cm
SET kind = CASE
    WHEN role IN ('user','system') THEN 'chat'
    WHEN role = 'assistant' AND EXISTS (
        SELECT 1 FROM token_usage tu WHERE tu.message_id = cm.id AND tu.phase = 'planning'
    ) THEN 'plan'
    WHEN role = 'assistant' AND EXISTS (
        SELECT 1 FROM token_usage tu WHERE tu.message_id = cm.id AND tu.phase = 'summary'
    ) THEN 'result'
    ELSE 'chat'
END;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_kind_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_kind_check CHECK (kind IN ('chat','plan','result'));
