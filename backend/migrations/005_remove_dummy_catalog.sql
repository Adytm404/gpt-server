DO $$
DECLARE
    seed_model_ids uuid[] := ARRAY[
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000004'::uuid
    ];
    seed_plan_ids uuid[] := ARRAY[
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid
    ];
    seed_revision_ids uuid[] := ARRAY[
        '30000000-0000-4000-8000-000000000001'::uuid,
        '30000000-0000-4000-8000-000000000002'::uuid
    ];
BEGIN
    DELETE FROM plan_allowed_models WHERE revision_id = ANY(seed_revision_ids);
    DELETE FROM subscription_plan_revisions WHERE id = ANY(seed_revision_ids);

    IF EXISTS (SELECT 1 FROM subscription_plan_revisions WHERE plan_id = ANY(seed_plan_ids)) THEN
        RAISE EXCEPTION 'cannot remove seeded plans: non-seeded revisions still reference exact seeded plan IDs';
    END IF;
    DELETE FROM subscription_plans WHERE id = ANY(seed_plan_ids);

    IF EXISTS (
        SELECT 1 FROM subscription_plan_revisions
        WHERE default_model_id = ANY(seed_model_ids) OR fallback_model_id = ANY(seed_model_ids)
    ) OR EXISTS (
        SELECT 1 FROM plan_allowed_models WHERE model_id = ANY(seed_model_ids)
    ) THEN
        RAISE EXCEPTION 'cannot remove seeded models: remaining plans reference exact seeded model IDs';
    END IF;

    DELETE FROM audit_events
    WHERE target_id = ANY(seed_model_ids || seed_plan_ids || seed_revision_ids);
    DELETE FROM ai_models WHERE id = ANY(seed_model_ids);
END $$;
