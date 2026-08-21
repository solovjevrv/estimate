CREATE TYPE "public"."board_share_role" AS ENUM('view', 'edit');--> statement-breakpoint
ALTER TABLE "board_items" DROP CONSTRAINT "board_items_parent_id_board_items_id_fk";
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "share_role" "board_share_role";