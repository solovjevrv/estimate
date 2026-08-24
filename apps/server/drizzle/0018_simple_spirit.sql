CREATE TABLE "personal_sticker_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"telegram_set_name" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_sticker_packs_owner_set_unique" UNIQUE("owner_id","telegram_set_name")
);
--> statement-breakpoint
CREATE TABLE "personal_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"telegram_file_unique_id" text NOT NULL,
	"emoji" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_sticker_packs" ADD CONSTRAINT "personal_sticker_packs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_stickers" ADD CONSTRAINT "personal_stickers_pack_id_personal_sticker_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."personal_sticker_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_sticker_packs_owner_id_idx" ON "personal_sticker_packs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "personal_stickers_pack_id_idx" ON "personal_stickers" USING btree ("pack_id");