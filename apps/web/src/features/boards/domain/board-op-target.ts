/**
 * Ключ цели операции доски — общий для `BoardOp` (клиент → сервер) и
 * `BoardCommittedOp` (рассылка сервера), см. 17.7. Раньше это были два
 * почти идентичных `switch` по `op.type` — они разошлись бы незаметно, если
 * бы кто-то поправил один и забыл про второй.
 *
 * Оба union-а фактически несут один и тот же контракт на каждом варианте:
 * `item.*` — либо целый `item`, либо голый `id`; `edge.*` — либо целый
 * `edge`, либо голый `id`. Единая структурная сигнатура ниже описывает эту
 * форму один раз; TypeScript проверяет, что КАЖДЫЙ вариант обоих union-ов ей
 * соответствует — если в `@poker/shared` появится операция другой формы,
 * это не пройдёт компиляцию здесь, а не тихо даст неверный ключ.
 */
type TargetableBoardOp =
  | { type: string; item: { id: string } }
  | { type: string; edge: { id: string } }
  | { type: string; id: string };

export function opTargetKey(op: TargetableBoardOp): string {
  const kind = op.type.startsWith('edge.') ? 'edge' : 'item';
  const id = 'item' in op ? op.item.id : 'edge' in op ? op.edge.id : op.id;
  return `${kind}:${id}`;
}
