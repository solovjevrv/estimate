import type { BoardItem, BoardSnapshot } from '@estimate/shared';

import { findStickerAsset, personalStickerUrl } from './config/sticker-packs';

const WIDTH = 960;
const HEIGHT = 540;
const PADDING = 36;
/**
 * Снимок хранится один на всех, а тема у каждого своя — поэтому фон прозрачный
 * (под ним фон карточки из токенов), а служебные линии и подписи нейтрально-серые,
 * читаемые и на светлом, и на тёмном фоне.
 */
const NEUTRAL_LINE = '#8b95a1';
const MEDIA_FILL = 'rgba(139, 149, 161, 0.35)';
/**
 * Сколько ждать одно медиа стикера. Очередь списка последовательная: без
 * таймаута зависший fetch/видео остановил бы превью всех следующих карточек.
 */
const MEDIA_TIMEOUT_MS = 5000;

/** Результат промиса или null, если он не успел за `ms` (сам промис не отменяется). */
function withTimeout<T>(promise: Promise<T | null>, ms = MEDIA_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(18, w / 5, h / 5));
}

function itemText(item: BoardItem): string {
  switch (item.content.type) {
    case 'sticky':
    case 'shape':
    case 'text':
      return item.content.text;
    case 'emoji':
      return item.content.emoji;
    case 'frame':
      return item.content.title;
    default:
      return '';
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  align: CanvasTextAlign = 'center',
): void {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.max(11, Math.min(fontSize, 28))}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  ctx.rect(x + 8, y + 8, Math.max(0, width - 16), Math.max(0, height - 16));
  ctx.clip();
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > width - 20 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, Math.max(1, Math.floor((height - 16) / (fontSize * 1.25))));
  const startY = y + height / 2 - ((visible.length - 1) * fontSize * 1.25) / 2;
  const textX = align === 'left' ? x + 12 : align === 'right' ? x + width - 12 : x + width / 2;
  visible.forEach((entry, index) => ctx.fillText(entry, textX, startY + index * fontSize * 1.25));
  ctx.restore();
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
): void {
  const source = image as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const sourceWidth = source.videoWidth ?? source.width ?? 0;
  const sourceHeight = source.videoHeight ?? source.height ?? 0;
  if (!sourceWidth || !sourceHeight) return;
  const ratio = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * ratio;
  const drawHeight = sourceHeight * ratio;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * Первый кадр видео-стикера, скопированный на canvas: сам `<video>` сразу
 * отпускает загрузку, чтобы не держать соединение после снимка.
 */
function loadVideoFrame(src: string): Promise<HTMLCanvasElement | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  const release = () => {
    video.removeAttribute('src');
    video.load();
  };
  const frame = new Promise<HTMLCanvasElement | null>((resolve) => {
    video.addEventListener('error', () => resolve(null), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        resolve(canvas.width && canvas.height ? canvas : null);
      },
      { once: true },
    );
    video.src = src;
  });
  return withTimeout(frame).finally(release);
}

/** Первый отрисованный кадр Telegram TGS (Lottie JSON), без запуска анимации. */
async function loadLottieFrame(src: string): Promise<HTMLCanvasElement | null> {
  try {
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    // Таймер до конца чтения тела: зависнуть может и само скачивание JSON
    const data: unknown = await fetch(src, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .finally(() => clearTimeout(abort));
    if (!data || typeof data !== 'object') return null;
    const host = document.createElement('div');
    const { default: lottie } = await import('lottie-web');
    const animation = lottie.loadAnimation({
      container: host,
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: data,
    });
    const canvas = await withTimeout(
      new Promise<HTMLCanvasElement | null>((resolve) => {
        animation.addEventListener('DOMLoaded', () => {
          animation.goToAndStop(0, true);
          const rendered = host.querySelector('canvas');
          if (!rendered) {
            resolve(null);
            return;
          }
          // destroy() очищает canvas lottie; возвращаем независимый снимок кадра.
          const frame = document.createElement('canvas');
          frame.width = rendered.width;
          frame.height = rendered.height;
          frame.getContext('2d')?.drawImage(rendered, 0, 0);
          resolve(frame);
        });
        animation.addEventListener('data_failed', () => resolve(null));
      }),
    );
    // destroy() и при таймауте: иначе lottie продолжит ждать шрифты/данные
    animation.destroy();
    return canvas;
  } catch {
    return null;
  }
}

async function loadStickerFrame(item: BoardItem): Promise<CanvasImageSource | null> {
  if (item.content.type !== 'sticker') return null;
  const source =
    findStickerAsset(item.content.pack, item.content.id)?.src ??
    personalStickerUrl(item.content.pack, item.content.id);
  if (item.content.format === 'animated') return loadLottieFrame(source);
  if (item.content.format === 'video') return loadVideoFrame(source);
  return withTimeout(loadImage(source));
}

/**
 * Лёгкий, изолированный от Vue Flow renderer для карточек списка. Он намеренно
 * не скачивает внешние картинки/GIF: одна карточка не должна удерживать очередь
 * из-за CORS или медленного CDN. Геометрия, текст, цвета и связи остаются
 * узнаваемым снимком доски.
 */
export async function renderBoardThumbnail(snapshot: BoardSnapshot): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const items = [...snapshot.items].filter((item) => item.content.type !== 'group');
  // Пустой доске снимок не нужен — карточка показывает заглушку из макета
  if (items.length === 0) return null;

  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  const scale = Math.min(
    (WIDTH - PADDING * 2) / Math.max(1, right - left),
    (HEIGHT - PADDING * 2) / Math.max(1, bottom - top),
    1,
  );
  const offsetX = (WIDTH - (right - left) * scale) / 2 - left * scale;
  const offsetY = (HEIGHT - (bottom - top) * scale) / 2 - top * scale;
  const point = (x: number, y: number) => ({ x: x * scale + offsetX, y: y * scale + offsetY });
  const byId = new Map(items.map((item) => [item.id, item]));

  ctx.strokeStyle = NEUTRAL_LINE;
  ctx.lineWidth = 2;
  for (const edge of snapshot.edges) {
    const source = byId.get(edge.sourceItemId);
    const target = byId.get(edge.targetItemId);
    if (!source || !target) continue;
    const a = point(source.x + source.width / 2, source.y + source.height / 2);
    const b = point(target.x + target.width / 2, target.y + target.height / 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const item of items.sort((a, b) => a.zIndex - b.zIndex)) {
    const { x, y } = point(item.x, item.y);
    const width = Math.max(3, item.width * scale);
    const height = Math.max(3, item.height * scale);
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);
    const text = itemText(item);
    // Текст на заливке стикера/фигуры — тёмный; текст прямо на холсте лежит на
    // фоне карточки, чей цвет зависит от темы, — нейтральный
    const textColor =
      item.style.textColor ?? (item.content.type === 'text' ? NEUTRAL_LINE : '#202936');
    if (item.content.type === 'frame') {
      ctx.strokeStyle = item.style.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, width, height);
      drawText(ctx, text, 0, 0, width, Math.min(height, 42), 16, NEUTRAL_LINE, 'left');
    } else if (item.content.type === 'text') {
      drawText(
        ctx,
        text,
        0,
        0,
        width,
        height,
        (item.style.fontSize ?? 20) * scale,
        textColor,
        item.style.textAlign ?? 'center',
      );
    } else if (item.content.type === 'emoji') {
      ctx.font = `${Math.min(width, height) * 0.7}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, width / 2, height / 2);
    } else {
      // Стикер на доске рисуется без подложки — серая заливка только у заглушек
      // (картинки/GIF не скачиваются, стикер не загрузился)
      const sticker = item.content.type === 'sticker' ? await loadStickerFrame(item) : null;
      if (sticker) {
        drawContainedImage(ctx, sticker, width, height);
        ctx.restore();
        continue;
      }
      ctx.fillStyle =
        item.content.type === 'image' ||
        item.content.type === 'sticker' ||
        item.content.type === 'giphy'
          ? MEDIA_FILL
          : item.style.color;
      if (item.content.type === 'shape' && item.content.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.content.type === 'shape' && item.content.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width, height / 2);
        ctx.lineTo(width / 2, height);
        ctx.lineTo(0, height / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        roundRect(ctx, 0, 0, width, height);
        ctx.fill();
      }
      if (item.content.type === 'sticker') {
        ctx.strokeStyle = NEUTRAL_LINE;
        ctx.lineWidth = 2;
        ctx.strokeRect(width * 0.3, height * 0.3, width * 0.4, height * 0.4);
      } else if (item.content.type === 'image' || item.content.type === 'giphy') {
        ctx.strokeStyle = NEUTRAL_LINE;
        ctx.lineWidth = 2;
        ctx.strokeRect(width * 0.3, height * 0.3, width * 0.4, height * 0.4);
      } else
        drawText(
          ctx,
          text,
          0,
          0,
          width,
          height,
          (item.style.fontSize ?? 20) * scale,
          textColor,
          item.style.textAlign ?? 'center',
        );
    }
    ctx.restore();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
}
