#!/usr/bin/env node
// Сборка фронта не должна отдавать браузеру комментарии разработчиков и source maps:
// они раскрывают внутреннюю логику и решения проекта. Запуск: после `pnpm build`,
// `node scripts/check-build-comments.mjs [каталог dist]`.
// Лицензионные `/*! … */` и аннотации сборщика (`/*#__PURE__*/`, `/*@__PURE__*/`) разрешены.
import console from 'node:console';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

import { parse } from 'acorn';

const root = process.argv[2] ?? 'apps/web/dist';

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const problems = [];
const report = (file, what, sample) =>
  problems.push(
    `${relative(root, file)}: ${what}${sample ? ` — ${sample.slice(0, 80).replace(/\s+/g, ' ')}` : ''}`,
  );

for (const file of walk(root)) {
  const ext = extname(file);
  if (ext === '.map') {
    report(file, 'source map');
    continue;
  }
  if (!['.js', '.mjs', '.css', '.html'].includes(ext)) continue;
  const text = readFileSync(file, 'utf8');

  if (ext === '.html') {
    const html = text.match(/<!--[\s\S]*?-->/);
    if (html) report(file, 'HTML-комментарий', html[0]);
  }
  if (/\/[/*]# sourceMappingURL=/.test(text)) report(file, 'ссылка на source map');

  // JS — комментарии берём из парсера: регулярка путает `/*` внутри регулярных
  // выражений и строк (например, CSS-строки сторонних библиотек) с комментарием
  const comments = [];
  if (ext === '.css') {
    for (const match of text.matchAll(/\/\*[\s\S]*?\*\//g)) comments.push(match[0]);
  } else if (ext !== '.html') {
    parse(text, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      onComment: (block, value) => comments.push(block ? `/*${value}*/` : `//${value}`),
    });
  } else {
    for (const [, body] of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      parse(body, {
        ecmaVersion: 'latest',
        onComment: (block, value) => comments.push(block ? `/*${value}*/` : `//${value}`),
      });
    }
  }
  const leaked = comments.find((comment) => !/^\/\*[!#@]/.test(comment));
  if (leaked) report(file, 'комментарий', leaked);
}

if (problems.length > 0) {
  console.error(`В сборке найдены комментарии или source maps (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Сборка чистая: комментариев и source maps нет (${root})`);
