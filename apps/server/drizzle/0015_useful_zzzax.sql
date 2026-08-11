-- WARNING: self-referencing FK в schema.ts намеренно НЕ описан через .references()
-- (TS25707 циркулярная типизация Drizzle). Если кто-то запустит
-- `pnpm --filter @poker/server db:generate`, Drizzle сгенерирует миграцию
-- DROP CONSTRAINT — DB-level safety net будет потерян, но приложение
-- продолжит работать (осираение детей эмулируется в board-ops.ts item.delete).
-- Не запускать db:generate без ручной проверки.

ALTER TABLE "board_items" ADD CONSTRAINT "board_items_parent_id_board_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."board_items"("id") ON DELETE set null ON UPDATE no action;