CREATE TYPE "public"."board_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "board_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"label" text,
	"style" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"parent_id" uuid,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"rotation" double precision DEFAULT 0 NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"style" jsonb NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"owner_id" uuid,
	"title" text NOT NULL,
	"status" "board_status" DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_edges" ADD CONSTRAINT "board_edges_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_edges" ADD CONSTRAINT "board_edges_source_item_id_board_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_edges" ADD CONSTRAINT "board_edges_target_item_id_board_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_edges_board_id_idx" ON "board_edges" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "board_items_board_id_idx" ON "board_items" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "boards_team_id_idx" ON "boards" USING btree ("team_id");