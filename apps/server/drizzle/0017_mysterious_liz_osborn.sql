CREATE TYPE "public"."board_template_scope" AS ENUM('builtin', 'personal', 'team');--> statement-breakpoint
CREATE TABLE "board_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "board_template_scope" NOT NULL,
	"owner_id" uuid,
	"team_id" uuid,
	"name" text NOT NULL,
	"name_key" text,
	"description" text,
	"description_key" text,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_templates" ADD CONSTRAINT "board_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_templates" ADD CONSTRAINT "board_templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_templates_owner_id_idx" ON "board_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "board_templates_team_id_idx" ON "board_templates" USING btree ("team_id");