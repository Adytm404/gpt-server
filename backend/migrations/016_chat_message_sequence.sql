CREATE SEQUENCE IF NOT EXISTS chat_message_global_sequence;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sequence bigint;

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               ORDER BY created_at,
                        CASE WHEN role = 'user' THEN 0 WHEN role = 'assistant' THEN 1 ELSE 2 END,
                        CASE WHEN kind = 'chat' THEN 0 WHEN kind = 'plan' THEN 1 WHEN kind = 'result' THEN 2 ELSE 3 END,
                        id
           ) AS sequence
    FROM chat_messages
)
UPDATE chat_messages cm
SET sequence = ranked.sequence
FROM ranked
WHERE ranked.id = cm.id
  AND EXISTS (SELECT 1 FROM chat_messages WHERE sequence IS NULL);

ALTER TABLE chat_messages ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN sequence SET DEFAULT nextval('chat_message_global_sequence');

SELECT setval('chat_message_global_sequence',
    COALESCE((SELECT max(sequence) FROM chat_messages), 1),
    EXISTS (SELECT 1 FROM chat_messages)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_sequence_idx ON chat_messages(sequence);
CREATE INDEX IF NOT EXISTS chat_messages_thread_sequence_idx ON chat_messages(thread_id, sequence);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid;

WITH replies AS (
    SELECT assistant.id AS assistant_id, matched.id AS user_id
    FROM chat_messages assistant
    CROSS JOIN LATERAL (
        SELECT candidate.id
        FROM chat_messages candidate
        WHERE candidate.thread_id = assistant.thread_id
          AND candidate.role = 'user'
          AND candidate.operation_id = assistant.operation_id
          AND candidate.sequence < assistant.sequence
        ORDER BY candidate.sequence DESC
        LIMIT 1
    ) matched
    WHERE assistant.role = 'assistant'
      AND assistant.operation_id IS NOT NULL
      AND assistant.reply_to_message_id IS NULL
)
UPDATE chat_messages assistant
SET reply_to_message_id = replies.user_id
FROM replies
WHERE assistant.id = replies.assistant_id;

WITH replies AS (
    SELECT assistant.id AS assistant_id, matched.id AS user_id
    FROM chat_messages assistant
    CROSS JOIN LATERAL (
        SELECT candidate.id
        FROM chat_messages candidate
        WHERE candidate.thread_id = assistant.thread_id
          AND candidate.role = 'user'
          AND candidate.sequence < assistant.sequence
        ORDER BY candidate.sequence DESC
        LIMIT 1
    ) matched
    WHERE assistant.role = 'assistant'
      AND assistant.reply_to_message_id IS NULL
)
UPDATE chat_messages assistant
SET reply_to_message_id = replies.user_id
FROM replies
WHERE assistant.id = replies.assistant_id;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'chat_messages'::regclass
          AND conname = 'chat_messages_reply_to_message_id_fkey'
    ) THEN
        ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_reply_to_message_id_fkey
            FOREIGN KEY (reply_to_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_messages_reply_to_message_idx ON chat_messages(reply_to_message_id);
