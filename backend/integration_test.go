package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIntegrationMigrationsAndServerCRUD(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("first migration: %v", err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("idempotent migration: %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	userID, workspaceID, serverID := uuid.New(), uuid.New(), uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO users(id,full_name,display_name,email,password_hash) VALUES($1,'Test User','Test User',$2,'test')`, userID, userID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspaces(id,name) VALUES($1,'Integration')`, workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, workspaceID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment) VALUES($1,$2,'API','127.0.0.1',22,'deploy','development')`, serverID, workspaceID); err != nil {
		t.Fatal(err)
	}
	var name string
	if err = tx.QueryRow(ctx, `UPDATE servers SET name='API 2' WHERE id=$1 AND workspace_id=$2 RETURNING name`, serverID, workspaceID).Scan(&name); err != nil || name != "API 2" {
		t.Fatalf("update: name=%q err=%v", name, err)
	}
	var otherWorkspaceCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM servers WHERE id=$1 AND workspace_id=$2`, serverID, uuid.New()).Scan(&otherWorkspaceCount); err != nil || otherWorkspaceCount != 0 {
		t.Fatalf("workspace isolation: count=%d err=%v", otherWorkspaceCount, err)
	}
	if _, err = tx.Exec(ctx, `UPDATE servers SET deleted_at=now() WHERE id=$1 AND workspace_id=$2`, serverID, workspaceID); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM servers WHERE id=$1 AND deleted_at IS NULL`, serverID).Scan(&visible); err != nil || visible != 0 {
		t.Fatalf("soft delete: count=%d err=%v", visible, err)
	}
}

func TestIntegrationDraftSlugAndPublishedModelDependency(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	modelID, planID, publishedID := uuid.New(), uuid.New(), uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO ai_models(id,external_model_id,name,provider,context_window) VALUES($1,$2,'Integration Model','test',1024)`, modelID, "integration-"+modelID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plans(id,slug) VALUES($1,$2)`, planID, "integration-"+planID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility) VALUES($1,$2,1,'Integration','integration','',0,0,'published',1,1,1000,100,100,'block_requests',$3,$3,'[]','private')`, publishedID, planID, modelID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO plan_allowed_models(revision_id,model_id) VALUES($1,$2)`, publishedID, modelID); err != nil {
		t.Fatal(err)
	}
	draftID := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility) SELECT $1,plan_id,revision+1,name,slug,description,price_cents,annual_price_cents,'draft',max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility FROM subscription_plan_revisions WHERE id=$2`, draftID, publishedID); err != nil {
		t.Fatalf("draft with same logical slug: %v", err)
	}
	var effectiveCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT DISTINCT ON (plan_id) id FROM subscription_plan_revisions WHERE plan_id=$1 AND status IN ('draft','published') ORDER BY plan_id,(status='draft') DESC) effective`, planID).Scan(&effectiveCount); err != nil || effectiveCount != 1 {
		t.Fatalf("effective plans count=%d err=%v", effectiveCount, err)
	}
	var used bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_plan_revisions p LEFT JOIN plan_allowed_models pam ON pam.revision_id=p.id WHERE p.status='published' AND (p.default_model_id=$1 OR p.fallback_model_id=$1 OR pam.model_id=$1))`, modelID).Scan(&used); err != nil || !used {
		t.Fatalf("published model dependency used=%v err=%v", used, err)
	}
}
