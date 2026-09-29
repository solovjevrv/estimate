import { ref, type Ref } from 'vue';

export interface AsyncActionOptions<TArgs extends unknown[], TResult> {
  /**
   * Единственная обязательная операция. Вызывается не более одного раза,
   * пока pending=true.
   */
  run: (...args: TArgs) => Promise<TResult>;

  /**
   * Вызывается после успешного run; result — результат run, затем исходные args.
   * Может быть async. Подходит для обновления локального состояния, закрытия
   * модалки, навигации и success-toast.
   */
  success?: (result: TResult, ...args: TArgs) => void | Promise<void>;

  /**
   * Вызывается при ошибке run; error остаётся unknown, затем исходные args.
   * Может быть async. Подходит для error-toast или специфического состояния
   * (например, joinFailed).
   */
  error?: (error: unknown, ...args: TArgs) => void | Promise<void>;
}

export interface AsyncAction<TArgs extends unknown[], TResult> {
  /** Только для чтения снаружи; используется в :loading / :disabled. */
  pending: Readonly<Ref<boolean>>;

  /**
   * Никогда не пробрасывает штатную ошибку операции в DOM-обработчик:
   * - успех: возвращает TResult;
   * - ошибка run или success: вызывает error (если задан), возвращает undefined;
   * - повторный вызов при pending=true: не запускает run повторно и возвращает undefined.
   */
  execute: (...args: TArgs) => Promise<TResult | undefined>;
}

/**
 * Универсальный слой состояния async-операции. Убирает повторяющийся
 * шаблон `ref(false) → try/catch/finally → toast` из UI-обработчиков.
 * Не зависит от Nuxt UI, vue-i18n, Pinia, роутера, ApiError и доменных модулей.
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  options: AsyncActionOptions<TArgs, TResult>,
): AsyncAction<TArgs, TResult> {
  const pending = ref(false);

  async function execute(...args: TArgs): Promise<TResult | undefined> {
    // Single-flight: повторный вызов, пока первая операция в полёте, игнорируем
    if (pending.value) return undefined;
    pending.value = true;

    try {
      const result = await options.run(...args);
      await options.success?.(result, ...args);
      return result;
    } catch (error) {
      await options.error?.(error, ...args);
      // Штатная ошибка операции не пробрасывается наружу (execute возвращает undefined)
      return undefined;
    } finally {
      pending.value = false;
    }
  }

  return { pending, execute };
}
