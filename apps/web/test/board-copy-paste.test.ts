import type { BoardItemContent, BoardItemStyle } from '@poker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  base64ToFile,
  BOARD_CLIPBOARD_SOURCE,
  BOARD_CLIPBOARD_VERSION,
  type BoardClipboardSourceItem,
  blobToBase64,
  hasActiveTextSelection,
  isPlainTextField,
  parseClipboardPayload,
  serializeSelection,
} from '../src/features/boards/domain/board-clipboard';

const STYLE: BoardItemStyle = { color: '#FCEB96' };

let sourceItemCounter = 0;

function sourceItem(
  content: BoardItemContent,
  overrides: Partial<BoardClipboardSourceItem> = {},
): BoardClipboardSourceItem {
  sourceItemCounter += 1;
  return {
    id: `item-${sourceItemCounter}`,
    parentId: null,
    content,
    style: STYLE,
    rotation: 0,
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    ...overrides,
  };
}

describe('blobToBase64 / base64ToFile', () => {
  it('конвертирует Blob в data URL и обратно в File с теми же байтами', async () => {
    const blob = new Blob(['hello board'], { type: 'text/plain' });
    const dataUrl = await blobToBase64(blob);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);

    const file = base64ToFile(dataUrl, 'text/plain', 'copy.txt');
    expect(file.name).toBe('copy.txt');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe('hello board');
  });

  it('base64ToFile бросает на некорректный data URL', () => {
    expect(() => base64ToFile('not-a-data-url', 'image/webp', 'x.webp')).toThrow();
  });
});

describe('serializeSelection / parseClipboardPayload — round-trip', () => {
  it('не-картиночные типы контента копируются как есть, позиции — относительно центра выделения', async () => {
    const sticky = sourceItem(
      { type: 'sticky', text: 'Привет' },
      { x: 0, y: 0, width: 100, height: 100 },
    );
    const emoji = sourceItem(
      { type: 'emoji', emoji: '🎉' },
      { x: 200, y: 0, width: 100, height: 100 },
    );

    const json = await serializeSelection([sticky, emoji]);
    const payload = parseClipboardPayload(json);

    expect(payload).not.toBeNull();
    expect(payload?.source).toBe(BOARD_CLIPBOARD_SOURCE);
    expect(payload?.version).toBe(BOARD_CLIPBOARD_VERSION);
    expect(payload?.items).toHaveLength(2);
    // bounding box [0,300) по x -> центр 150; sticky слева на 150, emoji справа на 150
    expect(payload?.items[0]).toMatchObject({
      content: { type: 'sticky', text: 'Привет' },
      relX: -150,
      relY: -50,
    });
    expect(payload?.items[1]).toMatchObject({
      content: { type: 'emoji', emoji: '🎉' },
      relX: 50,
      relY: -50,
    });
  });

  it('картинка сериализуется в base64 через fetch, а не как исходный URL', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    const fetchMock = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) });

    const image = sourceItem(
      { type: 'image', url: '/api/boards/1/assets/a.webp', width: 300, height: 200 },
      { width: 150, height: 100 },
    );

    const json = await serializeSelection([image], [], fetchMock as unknown as typeof fetch);
    const payload = parseClipboardPayload(json);

    expect(fetchMock).toHaveBeenCalledWith('/api/boards/1/assets/a.webp');
    expect(payload?.items).toHaveLength(1);
    const content = payload?.items[0]?.content;
    expect(content?.type).toBe('image');
    expect(content && 'base64' in content ? content.base64 : undefined).toMatch(
      /^data:image\/webp;base64,/,
    );
    expect(content && 'url' in content).toBe(false);
  });

  it('если байты картинки не удалось скачать — этот элемент выпадает из payload, остальные остаются', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    const image = sourceItem({
      type: 'image',
      url: '/api/boards/1/assets/a.webp',
      width: 100,
      height: 100,
    });
    const sticky = sourceItem({ type: 'sticky', text: 'ok' });

    const json = await serializeSelection(
      [image, sticky],
      [],
      fetchMock as unknown as typeof fetch,
    );
    const payload = parseClipboardPayload(json);

    expect(payload?.items).toHaveLength(1);
    expect(payload?.items[0]?.content).toEqual({ type: 'sticky', text: 'ok' });
  });

  it('пустое выделение сериализуется в payload с пустым items', async () => {
    const json = await serializeSelection([]);
    const payload = parseClipboardPayload(json);
    expect(payload?.items).toEqual([]);
  });

  it('parentIndex (14.3): ребёнок ссылается на индекс своего контейнера в ТОМ ЖЕ payload', async () => {
    const frame = sourceItem({ type: 'frame', title: 'Ф' });
    const child = sourceItem({ type: 'sticky', text: 'внутри' }, { parentId: frame.id });

    const json = await serializeSelection([frame, child]);
    const payload = parseClipboardPayload(json);

    expect(payload?.items).toHaveLength(2);
    expect(payload?.items[0]).toMatchObject({ parentIndex: null });
    expect(payload?.items[1]).toMatchObject({ parentIndex: 0 });
  });

  it('parentIndex верхнеуровневого элемента — null, даже если parentId задан, но контейнер не попал в выделение', async () => {
    const child = sourceItem(
      { type: 'sticky', text: 'без родителя в выделении' },
      { parentId: 'some-frame-not-in-selection' },
    );

    const json = await serializeSelection([child]);
    const payload = parseClipboardPayload(json);

    expect(payload?.items[0]).toMatchObject({ parentIndex: null });
  });

  it('parentIndex остаётся корректным после отсева несериализуемого элемента ПЕРЕД контейнером', async () => {
    // Регрессия: индекс родителя считается по ИСХОДНОМУ массиву, а не по
    // отфильтрованному — без ремаппинга после фильтрации parentIndex ребёнка
    // указывал бы на позицию, съехавшую из-за выпавшей картинки перед контейнером
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    const brokenImage = sourceItem({
      type: 'image',
      url: '/api/boards/1/assets/broken.webp',
      width: 100,
      height: 100,
    });
    const frame = sourceItem({ type: 'frame', title: 'Ф' });
    const child = sourceItem({ type: 'sticky', text: 'внутри' }, { parentId: frame.id });

    const json = await serializeSelection(
      [brokenImage, frame, child],
      [],
      fetchMock as unknown as typeof fetch,
    );
    const payload = parseClipboardPayload(json);

    expect(payload?.items).toHaveLength(2);
    expect(payload?.items[0]).toMatchObject({ content: { type: 'frame', title: 'Ф' } });
    expect(payload?.items[1]).toMatchObject({ content: { type: 'sticky' }, parentIndex: 0 });
  });

  it('включает рёбра, у которых оба конца входят в выделение, с ремапом на индексы items', async () => {
    const a = sourceItem({ type: 'sticky', text: 'A' });
    const b = sourceItem({ type: 'sticky', text: 'B' }, { x: 200 });
    const json = await serializeSelection(
      [a, b],
      [
        {
          sourceItemId: a.id,
          targetItemId: b.id,
          sourceHandle: 'right',
          targetHandle: 'left',
          label: null,
          style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
        },
      ],
    );
    const payload = parseClipboardPayload(json);
    expect(payload?.edges).toEqual([
      {
        sourceIndex: 0,
        targetIndex: 1,
        sourceHandle: 'right',
        targetHandle: 'left',
        label: null,
        style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
      },
    ]);
  });

  it('отбрасывает ребро, если один из концов не входит в выделение', async () => {
    const a = sourceItem({ type: 'sticky', text: 'A' });
    const b = sourceItem({ type: 'sticky', text: 'B' });
    const json = await serializeSelection(
      [a],
      [
        {
          sourceItemId: a.id,
          targetItemId: b.id,
          sourceHandle: null,
          targetHandle: null,
          label: null,
          style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
        },
      ],
    );
    const payload = parseClipboardPayload(json);
    expect(payload?.edges).toEqual([]);
  });

  it('отбрасывает ребро, если его конец — картинка, которая не сериализовалась (fetch упал)', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('network'));
    const image = sourceItem({ type: 'image', url: '/x.webp', width: 100, height: 100 });
    const sticky = sourceItem({ type: 'sticky', text: 'A' });
    const json = await serializeSelection(
      [image, sticky],
      [
        {
          sourceItemId: image.id,
          targetItemId: sticky.id,
          sourceHandle: null,
          targetHandle: null,
          label: null,
          style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
        },
      ],
      failingFetch as unknown as typeof fetch,
    );
    const payload = parseClipboardPayload(json);
    expect(payload?.items).toHaveLength(1); // картинка отсеялась
    expect(payload?.edges).toEqual([]);
  });
});

describe('parseClipboardPayload — валидация формата', () => {
  it('чужой source — null', () => {
    expect(
      parseClipboardPayload(JSON.stringify({ source: 'other-app', version: 1, items: [] })),
    ).toBeNull();
  });

  it('несовпадающая версия — null', () => {
    expect(
      parseClipboardPayload(
        JSON.stringify({ source: BOARD_CLIPBOARD_SOURCE, version: 999, items: [] }),
      ),
    ).toBeNull();
  });

  it('items не массив — null', () => {
    expect(
      parseClipboardPayload(
        JSON.stringify({
          source: BOARD_CLIPBOARD_SOURCE,
          version: BOARD_CLIPBOARD_VERSION,
          items: {},
        }),
      ),
    ).toBeNull();
  });

  it('поддерживает payload v1, скопированный до появления рёбер', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [],
      }),
    );

    expect(payload?.edges).toEqual([]);
  });

  it('отбрасывает невалидные рёбра из clipboard payload', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          null,
          { sourceIndex: 0, targetIndex: 1 },
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow' },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(1);
  });

  it('ребро без dash в style (payload до фичи) парсится — не отбрасывается, dash по умолчанию solid', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: { line: 'curved', markerStart: 'none', markerEnd: 'arrow' },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(1);
    // dash отсутствует в старом payload — резолвится в 'solid' сервером/адаптером
    expect(payload?.edges[0]!.style).toEqual({
      line: 'curved',
      markerStart: 'none',
      markerEnd: 'arrow',
    });
  });

  it('ребро без curveOffset в style (payload до фичи, 12.17) парсится без ошибки', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'none' },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(1);
    expect(payload?.edges[0]!.style.curveOffset).toBeUndefined();
  });

  it('ребро с корректным curveOffset в style парсится', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              curveOffset: { x: 10, y: -20 },
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.curveOffset).toEqual({ x: 10, y: -20 });
  });

  it('ребро с curveOffset: null (сброшенное смещение) парсится', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              curveOffset: null,
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.curveOffset).toBeNull();
  });

  it('ребро с нечисловым curveOffset отбрасывается', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              curveOffset: { x: 'oops', y: 20 },
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(0);
  });

  it('принимает payload без ключа labelOffset (старый буфер обмена)', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(1);
  });

  it('принимает явный labelOffset: null', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelOffset: null,
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.labelOffset).toBeNull();
  });

  it('принимает валидный labelOffset {t,distance}', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelOffset: { t: 0.3, distance: -20 },
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.labelOffset).toEqual({ t: 0.3, distance: -20 });
  });

  it('отклоняет labelOffset с нечисловым t', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelOffset: { t: 'oops', distance: 20 },
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(0);
  });

  it('принимает payload без ключей labelFontSize/labelTextAlign/labelTextColor (старый буфер обмена)', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(1);
  });

  it('принимает валидные labelFontSize/labelTextAlign/labelTextColor', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelFontSize: 18,
              labelTextAlign: 'right',
              labelTextColor: '#ABCDEF',
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.labelFontSize).toBe(18);
    expect(payload?.edges[0]!.style.labelTextAlign).toBe('right');
    expect(payload?.edges[0]!.style.labelTextColor).toBe('#ABCDEF');
  });

  it('отклоняет labelTextAlign вне списка допустимых значений', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelTextAlign: 'justify',
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(0);
  });

  it('принимает валидный labelBold', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelBold: true,
            },
          },
        ],
      }),
    );

    expect(payload?.edges[0]!.style.labelBold).toBe(true);
  });

  it('отклоняет labelBold не булевого типа', () => {
    const payload = parseClipboardPayload(
      JSON.stringify({
        source: BOARD_CLIPBOARD_SOURCE,
        version: BOARD_CLIPBOARD_VERSION,
        items: [{ content: { type: 'sticky', text: 'A' } }],
        edges: [
          {
            sourceIndex: 0,
            targetIndex: 0,
            sourceHandle: null,
            targetHandle: null,
            label: null,
            style: {
              line: 'curved',
              dash: 'solid',
              markerStart: 'none',
              markerEnd: 'none',
              labelBold: 'yes',
            },
          },
        ],
      }),
    );

    expect(payload?.edges).toHaveLength(0);
  });

  it('битый JSON — null, не бросает исключение', () => {
    expect(() => parseClipboardPayload('{ not valid json')).not.toThrow();
    expect(parseClipboardPayload('{ not valid json')).toBeNull();
  });

  it('произвольный скопированный текст (не JSON) — null', () => {
    expect(parseClipboardPayload('просто скопированный текст из другого приложения')).toBeNull();
  });
});

describe('isPlainTextField', () => {
  it('true для input/textarea, false для contenteditable-div и не-элементов', () => {
    expect(isPlainTextField(document.createElement('input'))).toBe(true);
    expect(isPlainTextField(document.createElement('textarea'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(isPlainTextField(div)).toBe(false);
    expect(isPlainTextField(null)).toBe(false);
  });
});

describe('hasActiveTextSelection', () => {
  function makeEditable(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('нет selection — false', () => {
    window.getSelection()?.removeAllRanges();
    expect(hasActiveTextSelection()).toBe(false);
  });

  it('коллапсированный caret (просто клик, без протяжки) — false', () => {
    const el = makeEditable('привет');
    const range = document.createRange();
    range.setStart(el.firstChild!, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(hasActiveTextSelection()).toBe(false);
  });

  it('реально протянутое выделение текста в одном поле — true', () => {
    const el = makeEditable('привет мир');
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 6);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(hasActiveTextSelection()).toBe(true);
  });

  it('выделение, растянутое shift-кликом между ДВУМЯ разными полями — false', () => {
    const first = makeEditable('первый');
    const second = makeEditable('второй');
    const range = document.createRange();
    range.setStart(first.firstChild!, 2);
    range.setEnd(second.firstChild!, 2);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // Именно этот кейс ловит баг 13.5: shift-клик по второму узлу холста
    // (добавление к выделению элементов) попутно тянет и нативный DOM-selection
    // через оба contenteditable — это не осознанное выделение текста
    expect(hasActiveTextSelection()).toBe(false);
  });

  it('выделение только из пробелов/переноса строки — false', () => {
    const el = makeEditable('  \n  ');
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, el.firstChild!.textContent!.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(hasActiveTextSelection()).toBe(false);
  });
});
