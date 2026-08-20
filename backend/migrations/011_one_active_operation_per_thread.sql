WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY thread_id ORDER BY created_at DESC, id DESC) AS position
    FROM operations
    WHERE status IN ('planning','pending_approval','approved','running')
), closed AS (
    UPDATE operations o
    SET status='failed', error='superseded during active operation migration', finished_at=now(), updated_at=now()
    FROM ranked r
    WHERE o.id=r.id AND r.position > 1
    RETURNING o.id
)
INSERT INTO operation_events(operation_id,event_type,payload)
SELECT id,'failed','{"error":"superseded during migration"}'::jsonb FROM closed;

CREATE UNIQUE INDEX IF NOT EXISTS operations_one_active_per_thread_idx
    ON operations(thread_id)
    WHERE status IN ('planning','pending_approval','approved','running');
