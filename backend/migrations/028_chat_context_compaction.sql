CREATE TABLE IF NOT EXISTS chat_context_compactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL UNIQUE REFERENCES chat_threads(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    summary text NOT NULL,
    source_sequence bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_context_compactions_workspace_idx
    ON chat_context_compactions(workspace_id, updated_at DESC);
