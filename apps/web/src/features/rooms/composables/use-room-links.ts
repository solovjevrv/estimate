/** Форма ссылок Jira/Confluence комнаты — редактирование с версионированием против гонки с рассылкой */
import type { FormError } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { isHttpUrl, trimText } from '@poker/shared';
import { reactive, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';
import type { useRoomStore } from '../../../stores/room';

export interface UseRoomLinksOptions {
  room: ReturnType<typeof useRoomStore>;
}

export function useRoomLinks(options: UseRoomLinksOptions): {
  linksForm: { jiraUrl: string; confluenceUrl: string };
  linksDirty: Ref<boolean>;
  savingLinks: Readonly<Ref<boolean>>;
  validateLinks: (state: { jiraUrl: string; confluenceUrl: string }) => FormError[];
  onSaveLinks: () => Promise<void>;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { room } = options;

  const linksForm = reactive({ jiraUrl: '', confluenceUrl: '' });
  /** Есть несохранённая правка — рассылка с сервера не должна её затереть */
  const linksDirty = ref(false);
  /**
   * Версия, на которой основан черновик. Пока он не сохранён, рассылки могут
   * подвинуть версию в сторе вперёд — если бы сохранение брало версию оттуда,
   * а не отсюда, оно бы прошло поверх чужой правки, не заметив её.
   */
  const linksBaseVersion = ref<number | null>(null);

  watch(
    () => room.room,
    (current, previous) => {
      // Переход в другую комнату без перезагрузки страницы (тот же компонент) не должен
      // протащить несохранённый черновик ссылок прежней комнаты в новую
      if (current?.id !== previous?.id) {
        linksDirty.value = false;
      }
      if (!current || linksDirty.value) return;
      linksForm.jiraUrl = current.jiraUrl ?? '';
      linksForm.confluenceUrl = current.confluenceUrl ?? '';
      linksBaseVersion.value = current.linksVersion;
    },
    { immediate: true },
  );

  function validateLinks(state: { jiraUrl: string; confluenceUrl: string }): FormError[] {
    const errors: FormError[] = [];
    if (trimText(state.jiraUrl) && !isHttpUrl(trimText(state.jiraUrl))) {
      errors.push({ name: 'jiraUrl', message: t('room.linksInvalid') });
    }
    if (trimText(state.confluenceUrl) && !isHttpUrl(trimText(state.confluenceUrl))) {
      errors.push({ name: 'confluenceUrl', message: t('room.linksInvalid') });
    }
    return errors;
  }

  const { pending: savingLinks, execute: saveLinks } = useAsyncAction({
    run: () =>
      room.updateLinks({
        jiraUrl: trimText(linksForm.jiraUrl),
        confluenceUrl: trimText(linksForm.confluenceUrl),
        version: linksBaseVersion.value,
      }),
    success: () => {
      linksDirty.value = false;
    },
    error: () => {
      toast.add({ title: t('room.linksError'), color: 'error' });
    },
  });

  async function onSaveLinks(): Promise<void> {
    await saveLinks();
  }

  return { linksForm, linksDirty, savingLinks, validateLinks, onSaveLinks };
}
