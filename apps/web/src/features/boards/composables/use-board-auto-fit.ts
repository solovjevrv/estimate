import { ref, watch, type Ref } from 'vue';

export interface UseBoardAutoFitOptions {
  /**
   * Сигнал «у всех текущих узлов уже есть размеры» — тот же, на который
   * опирался внутренний `fit-view-on-init`. Передаётся снаружи (не через
   * `useNodesInitialized()` внутри composable) — Vue Flow здесь не должен
   * импортироваться напрямую, только через renderer-компонент (17.1/19.36).
   */
  nodesInitialized: Ref<boolean>;
  fitView: (options: { maxZoom: number }) => unknown;
}

/**
 * Автофит при первом появлении содержимого доски (17.12) — раньше это делал
 * булев проп `fit-view-on-init` у `<VueFlow>`, но он вызывает библиотечный
 * `fitView()` совсем без опций, так что зум ограничен только общим
 * `:max-zoom="2"`: для доски с одним маленьким стикером итог — зум 200% сразу
 * после создания первого элемента (воспроизведено в
 * `boards-frames-groups.spec.ts`). Автофит без явного действия пользователя
 * не должен приближать БЛИЖЕ 100% — обычный ручной fit-view (Ctrl+1, тулбар)
 * по-прежнему волен использовать весь `:max-zoom`.
 *
 * `useNodesInitialized()` — тот же сигнал «у всех текущих узлов уже есть
 * размеры», на который опирался внутренний `fit-view-on-init`: вызывать
 * `fitView` раньше бессмысленно, узлы без dimensions в подгонку не попадают.
 *
 * `rearm()` — вызывать при смене доски: `BoardPage.vue` переиспользует один и
 * тот же `BoardCanvas` (меняет пропы, не размонтирует компонент), без этого
 * вторая и последующие доски за сессию открывались бы без начальной подгонки
 * вида вовсе.
 */
export function useBoardAutoFit({ nodesInitialized, fitView }: UseBoardAutoFitOptions) {
  const done = ref(false);

  watch(nodesInitialized, (ready) => {
    if (!ready || done.value) return;
    done.value = true;
    void fitView({ maxZoom: 1 });
  });

  function rearm(): void {
    done.value = false;
  }

  return { rearm };
}
