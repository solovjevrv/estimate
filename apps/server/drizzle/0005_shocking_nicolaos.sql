-- Индекс на предикате role = 'owner' блокирует смену типа колонки ниже — сносим его первым
DROP INDEX "team_members_single_owner_idx";--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "role" SET DEFAULT 'member'::text;--> statement-breakpoint
-- Роль owner упраздняется: прежний единственный владелец команды становится админом (админов теперь может быть несколько)
UPDATE "team_members" SET "role" = 'admin' WHERE "role" = 'owner';--> statement-breakpoint
DROP TYPE "public"."team_role";--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('admin', 'member', 'guest');--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "role" SET DEFAULT 'member'::"public"."team_role";--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "role" SET DATA TYPE "public"."team_role" USING "role"::"public"."team_role";