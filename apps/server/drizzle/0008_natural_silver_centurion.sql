ALTER TABLE "rooms" ADD COLUMN "jira_url" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "confluence_url" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "links_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Переносим ссылки последнего раунда каждой комнаты на саму комнату — раньше они
-- жили на раунде, теперь принадлежат комнате целиком (7.25). История ссылок
-- прошлых раундов при этом не сохраняется — так и задумано.
UPDATE "rooms" r SET
  "jira_url" = latest.jira_url,
  "confluence_url" = latest.confluence_url,
  "links_version" = latest.links_version
FROM (
  SELECT DISTINCT ON (room_id) room_id, jira_url, confluence_url, links_version
  FROM "rounds"
  ORDER BY room_id, seq DESC
) AS latest
WHERE r.id = latest.room_id;--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "jira_url";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "confluence_url";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "links_version";