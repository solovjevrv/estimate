import ui from '@nuxt/ui/vue-plugin';
import type { AuthUser } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import AvatarCropModal from '../src/components/AvatarCropModal.vue';
import { createAppI18n } from '../src/i18n';
import { createAppRouter } from '../src/router';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const user: AuthUser = {
  id: 'u1',
  provider: 'google',
  email: 'ivan@example.com',
  name: 'Иван',
  jobTitle: null,
  avatarUrl: 'https://provider.example.com/avatar.png',
};

type Handlers = Record<string, () => Response>;

function makeFetch(handlers: Handlers = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = handlers[`${method} ${url}`];
    if (handler) return Promise.resolve(handler());
    if (url === '/api/me') return Promise.resolve(json(200, { user }));
    if (url === '/api/auth/refresh') {
      return Promise.resolve(json(401, { error: 'unauthorized', message: 'нет' }));
    }
    if (url === '/api/auth/providers') {
      return Promise.resolve(json(200, { providers: ['google', 'yandex'] }));
    }
    return Promise.resolve(json(404, { error: 'not_found', message: 'нет' }));
  });
}

let activeWrapper: ReturnType<typeof mount> | null = null;

async function mountApp(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  const pinia = createPinia();
  const router = createAppRouter(createMemoryHistory());
  const wrapper = mount(App, {
    // Реальный Cropper требует canvas/URL.createObjectURL, которых нет в jsdom —
    // здесь важна только связка «выбор файла → модалка → confirm → загрузка», не сам кроп
    global: { plugins: [pinia, router, createAppI18n('ru'), ui], stubs: { AvatarCropModal: true } },
    attachTo: document.body,
  });
  activeWrapper = wrapper;
  await router.push('/profile');
  await router.isReady();
  return { wrapper, router };
}

function selectFile(wrapper: ReturnType<typeof mount>, file: File): Promise<void> {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  return input.trigger('change');
}

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('страница «Профиль» — аватарка (10.15)', () => {
  it('показывает кнопку смены фото', async () => {
    const { wrapper } = await mountApp(makeFetch());

    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));
    expect(wrapper.text()).toContain('Сменить фото');
  });

  it('отклоняет недопустимый тип файла до открытия кроппера', async () => {
    const { wrapper } = await mountApp(makeFetch());
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    await selectFile(wrapper, file);

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Поддерживаются только JPEG, PNG и WebP'),
    );
    expect(wrapper.findComponent(AvatarCropModal).props('file')).toBeNull();
  });

  it('отклоняет слишком большой файл до открытия кроппера', async () => {
    const { wrapper } = await mountApp(makeFetch());
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const huge = new File([new Uint8Array(9 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });
    await selectFile(wrapper, huge);

    await vi.waitFor(() => expect(wrapper.text()).toContain('Файл слишком большой'));
    expect(wrapper.findComponent(AvatarCropModal).props('file')).toBeNull();
  });

  it('валидный файл открывает кроппер, подтверждение кропа загружает аватарку', async () => {
    const updated: AuthUser = { ...user, avatarUrl: '/api/avatars/abc.webp' };
    const { wrapper } = await mountApp(
      makeFetch({ 'POST /api/me/avatar': () => json(200, { user: updated }) }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await selectFile(wrapper, file);

    const modal = wrapper.findComponent(AvatarCropModal);
    expect(modal.props('file')).toBe(file);
    expect(modal.props('open')).toBe(true);

    await modal.vm.$emit('confirm', new Blob(['webp-bytes'], { type: 'image/webp' }));

    await vi.waitFor(() => expect(wrapper.text()).toContain('Аватарка обновлена'));
    expect(wrapper.find('img').attributes('src')).toBe(updated.avatarUrl);
  });

  it('показывает ошибку, если загрузка отклонена сервером', async () => {
    const { wrapper } = await mountApp(
      makeFetch({
        'POST /api/me/avatar': () => json(400, { error: 'bad_request', message: 'плохой файл' }),
      }),
    );
    await vi.waitFor(() => expect(wrapper.text()).toContain('ivan@example.com'));

    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await selectFile(wrapper, file);
    await wrapper.findComponent(AvatarCropModal).vm.$emit('confirm', new Blob(['x']));

    await vi.waitFor(() => expect(wrapper.text()).toContain('Не удалось сохранить аватарку'));
  });
});
