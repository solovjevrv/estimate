ALTER TABLE "rooms" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "board_item_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_board_id_idx" ON "rooms" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_board_item_id_idx" ON "rooms" USING btree ("board_item_id");