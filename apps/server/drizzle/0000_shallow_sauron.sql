CREATE TYPE "public"."auth_provider" AS ENUM('google', 'yandex');--> statement-breakpoint
CREATE TYPE "public"."deck_type" AS ENUM('fibonacci', 'scale_0_5');--> statement-breakpoint
CREATE TYPE "public"."room_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('voting', 'revealed');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"creator_id" uuid,
	"name" text NOT NULL,
	"status" "room_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"deck_type" "deck_type" NOT NULL,
	"jira_url" text,
	"confluence_url" text,
	"status" "round_status" DEFAULT 'voting' NOT NULL,
	"average" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_session_id" text,
	"guest_name" text,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_identity_check" CHECK ((user_id is not null) <> (guest_session_id is not null)),
	CONSTRAINT "votes_guest_name_check" CHECK (guest_session_id is null or guest_name is not null),
	CONSTRAINT "votes_value_check" CHECK (value >= 0)
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_team_id_idx" ON "rooms" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_room_id_seq_idx" ON "rounds" USING btree ("room_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_provider_id_idx" ON "users" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "votes_round_id_idx" ON "votes" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_round_user_idx" ON "votes" USING btree ("round_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "votes_round_guest_idx" ON "votes" USING btree ("round_id","guest_session_id") WHERE guest_session_id is not null;