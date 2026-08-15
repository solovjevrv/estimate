import { reactive, ref } from 'vue';

export interface EntityModal {
  /** Управляет видимостью модалки в шаблоне. */
  open: boolean;
  /** Открывает модалку. Начальное значение поля задаёт компонент формы. */
  show: () => void;
  /** Закрывает модалку; форма очищает своё локальное состояние по v-model. */
  close: () => void;
}

/**
 * Стандартное состояние короткой create/rename-модалки.
 *
 * Текст и валидация намеренно принадлежат `EntityTextModal`: при закрытии по
 * Esc/overlay он очищается так же, как при кнопке «Отмена», и страницы не
 * дублируют `ref + watch` для каждого имени сущности.
 */
export function useEntityModal(): EntityModal {
  const open = ref(false);

  function show(): void {
    open.value = true;
  }

  function close(): void {
    open.value = false;
  }

  return reactive({ open, show, close });
}
