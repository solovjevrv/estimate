import type { BoardTemplateItem } from '@poker/shared';

export interface BoardTemplateSeedRow {
  id: string;
  nameKey: string;
  name: string;
  descriptionKey: string;
  description: string;
  items: BoardTemplateItem[];
}

const STICKY_NOTE_COLOR = '#FCEB96';

export const BOARD_TEMPLATE_SEEDS: BoardTemplateSeedRow[] = [
  {
    id: '9f3a1b2c-c111-4a11-8b11-000000000001',
    nameKey: 'board.templates.retroStartStopContinue.name',
    name: 'Ретро: Start / Stop / Continue',
    descriptionKey: 'board.templates.retroStartStopContinue.description',
    description: 'Что начать, прекратить и продолжать делать',
    items: [
      { key: 'start-frame', parentKey: null, content: { type: 'frame', title: 'Start' }, x: 0, y: 0, width: 380, height: 480, color: '#B6E565', zIndex: 0 },
      { key: 'start-note', parentKey: 'start-frame', content: { type: 'sticky', text: 'Что стоит начать делать?' }, x: 100, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'stop-frame', parentKey: null, content: { type: 'frame', title: 'Stop' }, x: 420, y: 0, width: 380, height: 480, color: '#FF9595', zIndex: 0 },
      { key: 'stop-note', parentKey: 'stop-frame', content: { type: 'sticky', text: 'Что стоит прекратить делать?' }, x: 520, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'continue-frame', parentKey: null, content: { type: 'frame', title: 'Continue' }, x: 840, y: 0, width: 380, height: 480, color: '#7DA9F6', zIndex: 0 },
      { key: 'continue-note', parentKey: 'continue-frame', content: { type: 'sticky', text: 'Что стоит продолжать делать?' }, x: 940, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
    ],
  },
  {
    id: '9f3a1b2c-c111-4a11-8b11-000000000002',
    nameKey: 'board.templates.retroMadSadGlad.name',
    name: 'Ретро: Mad / Sad / Glad',
    descriptionKey: 'board.templates.retroMadSadGlad.description',
    description: 'Что злило, расстраивало и радовало в спринте',
    items: [
      { key: 'mad-frame', parentKey: null, content: { type: 'frame', title: 'Mad' }, x: 0, y: 0, width: 380, height: 480, color: '#FF9595', zIndex: 0 },
      { key: 'mad-note', parentKey: 'mad-frame', content: { type: 'sticky', text: 'Что вас злило в этом спринте?' }, x: 100, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'sad-frame', parentKey: null, content: { type: 'frame', title: 'Sad' }, x: 420, y: 0, width: 380, height: 480, color: '#7DA9F6', zIndex: 0 },
      { key: 'sad-note', parentKey: 'sad-frame', content: { type: 'sticky', text: 'Что вас расстраивало?' }, x: 520, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'glad-frame', parentKey: null, content: { type: 'frame', title: 'Glad' }, x: 840, y: 0, width: 380, height: 480, color: '#B6E565', zIndex: 0 },
      { key: 'glad-note', parentKey: 'glad-frame', content: { type: 'sticky', text: 'Что вас радовало?' }, x: 940, y: 30, width: 180, height: 120, color: STICKY_NOTE_COLOR, zIndex: 1 },
    ],
  },
  {
    id: '9f3a1b2c-c111-4a11-8b11-000000000003',
    nameKey: 'board.templates.leanCanvas.name',
    name: 'Lean Canvas',
    descriptionKey: 'board.templates.leanCanvas.description',
    description: 'Бизнес-модель на одной странице',
    items: [
      { key: 'problem', parentKey: null, content: { type: 'frame', title: 'Проблема' }, x: 0, y: 0, width: 280, height: 360, color: '#8FE3FF', zIndex: 0 },
      { key: 'problem-note', parentKey: 'problem', content: { type: 'sticky', text: 'Топ-3 проблемы клиентов' }, x: 20, y: 30, width: 240, height: 100, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'solution', parentKey: null, content: { type: 'frame', title: 'Решение' }, x: 300, y: 0, width: 280, height: 170, color: '#8FE3FF', zIndex: 0 },
      { key: 'solution-note', parentKey: 'solution', content: { type: 'sticky', text: 'Топ-3 функции, решающие проблемы' }, x: 320, y: 30, width: 240, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'keyMetrics', parentKey: null, content: { type: 'frame', title: 'Ключевые метрики' }, x: 300, y: 190, width: 280, height: 170, color: '#8FE3FF', zIndex: 0 },
      { key: 'keyMetrics-note', parentKey: 'keyMetrics', content: { type: 'sticky', text: 'Как измеряете успех?' }, x: 320, y: 220, width: 240, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'uvp', parentKey: null, content: { type: 'frame', title: 'Уникальное ценностное предложение' }, x: 600, y: 0, width: 280, height: 360, color: '#B4A7FA', zIndex: 0 },
      { key: 'uvp-note', parentKey: 'uvp', content: { type: 'sticky', text: 'Почему вы отличаетесь и стоите внимания?' }, x: 620, y: 30, width: 240, height: 100, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'unfairAdvantage', parentKey: null, content: { type: 'frame', title: 'Нечестное преимущество' }, x: 900, y: 0, width: 280, height: 170, color: '#FCB97D', zIndex: 0 },
      { key: 'unfairAdvantage-note', parentKey: 'unfairAdvantage', content: { type: 'sticky', text: 'То, что нельзя легко скопировать' }, x: 920, y: 30, width: 240, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'channels', parentKey: null, content: { type: 'frame', title: 'Каналы' }, x: 900, y: 190, width: 280, height: 170, color: '#FCB97D', zIndex: 0 },
      { key: 'channels-note', parentKey: 'channels', content: { type: 'sticky', text: 'Как вы доберётесь до клиентов?' }, x: 920, y: 220, width: 240, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'customerSegments', parentKey: null, content: { type: 'frame', title: 'Сегменты клиентов' }, x: 1200, y: 0, width: 280, height: 360, color: '#B6E565', zIndex: 0 },
      { key: 'customerSegments-note', parentKey: 'customerSegments', content: { type: 'sticky', text: 'Целевые клиенты и ранние последователи' }, x: 1220, y: 30, width: 240, height: 100, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'costStructure', parentKey: null, content: { type: 'frame', title: 'Структура затрат' }, x: 0, y: 380, width: 730, height: 180, color: '#FCE269', zIndex: 0 },
      { key: 'costStructure-note', parentKey: 'costStructure', content: { type: 'sticky', text: 'Основные статьи расходов' }, x: 20, y: 420, width: 300, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'revenueStreams', parentKey: null, content: { type: 'frame', title: 'Потоки доходов' }, x: 750, y: 380, width: 730, height: 180, color: '#FCE269', zIndex: 0 },
      { key: 'revenueStreams-note', parentKey: 'revenueStreams', content: { type: 'sticky', text: 'Источники дохода' }, x: 770, y: 420, width: 300, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
    ],
  },
  {
    id: '9f3a1b2c-c111-4a11-8b11-000000000004',
    nameKey: 'board.templates.storyMapping.name',
    name: 'User Story Mapping',
    descriptionKey: 'board.templates.storyMapping.description',
    description: 'Путь пользователя и релизы по шагам',
    items: [
      { key: 'step1', parentKey: null, content: { type: 'frame', title: 'Шаг 1' }, x: 0, y: 0, width: 220, height: 120, color: '#8FE3FF', zIndex: 0 },
      { key: 'step1-note', parentKey: 'step1', content: { type: 'sticky', text: 'Что делает пользователь на этом шаге?' }, x: 20, y: 35, width: 180, height: 70, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'step2', parentKey: null, content: { type: 'frame', title: 'Шаг 2' }, x: 240, y: 0, width: 220, height: 120, color: '#8FE3FF', zIndex: 0 },
      { key: 'step2-note', parentKey: 'step2', content: { type: 'sticky', text: 'Что делает пользователь на этом шаге?' }, x: 260, y: 35, width: 180, height: 70, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'step3', parentKey: null, content: { type: 'frame', title: 'Шаг 3' }, x: 480, y: 0, width: 220, height: 120, color: '#8FE3FF', zIndex: 0 },
      { key: 'step3-note', parentKey: 'step3', content: { type: 'sticky', text: 'Что делает пользователь на этом шаге?' }, x: 500, y: 35, width: 180, height: 70, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'step4', parentKey: null, content: { type: 'frame', title: 'Шаг 4' }, x: 720, y: 0, width: 220, height: 120, color: '#8FE3FF', zIndex: 0 },
      { key: 'step4-note', parentKey: 'step4', content: { type: 'sticky', text: 'Что делает пользователь на этом шаге?' }, x: 740, y: 35, width: 180, height: 70, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'step5', parentKey: null, content: { type: 'frame', title: 'Шаг 5' }, x: 960, y: 0, width: 220, height: 120, color: '#8FE3FF', zIndex: 0 },
      { key: 'step5-note', parentKey: 'step5', content: { type: 'sticky', text: 'Что делает пользователь на этом шаге?' }, x: 980, y: 35, width: 180, height: 70, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'release1', parentKey: null, content: { type: 'frame', title: 'Релиз 1 — MVP' }, x: 0, y: 140, width: 1180, height: 200, color: '#B6E565', zIndex: 0 },
      { key: 'release1-note', parentKey: 'release1', content: { type: 'sticky', text: 'Перетащите сюда истории для этого релиза' }, x: 20, y: 180, width: 300, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
      { key: 'release2', parentKey: null, content: { type: 'frame', title: 'Релиз 2 — далее' }, x: 0, y: 360, width: 1180, height: 200, color: '#FFFFFF', zIndex: 0 },
      { key: 'release2-note', parentKey: 'release2', content: { type: 'sticky', text: 'Перетащите сюда истории для этого релиза' }, x: 20, y: 400, width: 300, height: 90, color: STICKY_NOTE_COLOR, zIndex: 1 },
    ],
  },
];
