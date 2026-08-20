package main

import (
	"io/fs"
	"reflect"
	"strings"
	"testing"
)

func TestEmbeddedMigrationOrderAndLegacyServerRepair(t *testing.T) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	want := []string{"001_auth.sql", "002_catalog_servers.sql", "003_legacy_servers_health.sql", "004_legacy_audit_defaults.sql"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("migration order = %v, want %v", names, want)
	}

	sql, err := migrationFiles.ReadFile("migrations/003_legacy_servers_health.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(sql)
	for _, clause := range []string{
		"encrypted_private_key DROP NOT NULL",
		"metadata SET DEFAULT '{}'::jsonb",
		"SET ssh_user = username",
		"username DROP NOT NULL",
		"ADD COLUMN IF NOT EXISTS disk_percent",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("003 migration missing %q", clause)
		}
	}
	if strings.Contains(strings.ToUpper(content), "DROP TABLE") {
		t.Fatal("003 migration must not drop tables")
	}
	if strings.Contains(content, "legacy_column") || strings.Contains(content, "information_schema.columns\n        WHERE") && strings.Contains(content, "column_name NOT IN") {
		t.Fatal("003 migration must not relax unknown columns")
	}
}

func TestCatalogMigrationUsesCanonicalPlanSlugAndIndependentModelSeeds(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/002_catalog_servers.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"subscription_plans ADD COLUMN IF NOT EXISTS slug",
		"subscription_plans_slug_idx",
		"DROP INDEX IF EXISTS plan_live_slug_idx",
		"ON CONFLICT DO NOTHING",
		"ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS credential_configured",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("002 migration missing %q", clause)
		}
	}
	if strings.Contains(content, "WHERE NOT EXISTS (SELECT 1 FROM ai_models)") {
		t.Fatal("model seeds still depend on empty table")
	}
}

func TestCatalogMigrationRepairsLegacyAuditAndHealthTables(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/002_catalog_servers.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_type",
		"ALTER TABLE audit_events ALTER COLUMN workspace_id DROP NOT NULL",
		"ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS cpu_percent",
		"ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS memory_percent",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("002 migration missing %q", clause)
		}
	}
}
