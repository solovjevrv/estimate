CREATE TYPE "public"."board_voting_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TABLE "board_votes" (
	"voting_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"participant_id" text NOT NULL,
	"participant_name" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "board_votes_voting_id_item_id_participant_id_pk" PRIMARY KEY("voting_id","item_id","participant_id"),
	CONSTRAINT "board_votes_count_positive" CHECK ("board_votes"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "board_votings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"created_by" uuid,
	"status" "board_voting_status" DEFAULT 'active' NOT NULL,
	"votes_per_participant" integer,
	"max_per_item" integer,
	"item_ids" uuid[],
	"with_timer" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_voting_id_board_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."board_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_item_id_board_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votings" ADD CONSTRAINT "board_votings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votings" ADD CONSTRAINT "board_votings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_votings_board_id_idx" ON "board_votings" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_votings_one_active_idx" ON "board_votings" USING btree ("board_id") WHERE "board_votings"."status" = 'active';