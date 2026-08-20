ALTER TABLE ai_models ADD COLUMN base_url text;
UPDATE ai_models SET base_url = '' WHERE base_url IS NULL;
ALTER TABLE ai_models ALTER COLUMN base_url SET DEFAULT '';
ALTER TABLE ai_models ALTER COLUMN base_url SET NOT NULL;
