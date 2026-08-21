/** Реакции-эмодзи на карточке участника (10.10) — постоянный бейдж-счётчик и одноразовая анимация (10.12) */
import { useToast } from '@nuxt/ui/composables';
import type { Participant, Reaction, ReactionEmoji } from '@poker/shared';
import { reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  FlyingReaction,
  ReceivedReaction,
} from '../../../components/room/participant-reactions';
import type { useRoomStore } from '../../../stores/room';

export interface UseRoomReactionsOptions {
  room: ReturnType<typeof useRoomStore>;
}

export function useRoomReactions(options: UseRoomReactionsOptions): {
  receivedReactionsFor: (participantId: string) => ReceivedReaction[];
  flyingReactionsFor: (participantId: string) => FlyingReaction[];
  onReactClick: (participant: Participant, emoji: ReactionEmoji) => Promise<void>;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { room } = options;

  /**
   * Одинаковые реакции разных участников схлопываются в одну со счётчиком (как
   * реакции на сообщение в Telegram) — иначе при десятке участников бейджи не
   * поместились бы под карточкой шириной 130px. Набор эмодзи фиксирован
   * (`REACTION_EMOJIS`), поэтому уникальных групп на карточке не больше его длины.
   */
  function receivedReactionsFor(participantId: string): ReceivedReaction[] {
    const forParticipant = room.reactions.filter((r) => r.toParticipantId === participantId);
    const byEmoji = new Map<
      ReceivedReaction['emoji'],
      { fromNames: string[]; reactedByMe: boolean }
    >();
    for (const r of forParticipant) {
      const fromName =
        room.participants.find((p) => p.participantId === r.fromParticipantId)?.name ?? '';
      const group = byEmoji.get(r.emoji) ?? { fromNames: [], reactedByMe: false };
      group.fromNames.push(fromName);
      if (r.fromParticipantId === room.participantId) {
        group.reactedByMe = true;
      }
      byEmoji.set(r.emoji, group);
    }
    return Array.from(byEmoji.entries()).map(([emoji, { fromNames, reactedByMe }]) => ({
      emoji,
      count: fromNames.length,
      fromNames,
      reactedByMe,
    }));
  }

  async function onReactClick(participant: Participant, emoji: ReactionEmoji): Promise<void> {
    try {
      await room.sendReaction(participant.participantId, emoji);
    } catch {
      toast.add({ title: t('room.reactionError'), color: 'error' });
    }
  }

  /**
   * Одноразовая «вылетающая» анимация эмодзи над карточкой адресата (10.12, Meet-style) —
   * отдельно от постоянного бейджа-счётчика (10.10). `room.reactions` приходит только целиком
   * с рассылкой `room_state` (нет отдельного дискретного события), поэтому свежедобавленные
   * реакции ловим сравнением с предыдущим снимком списка.
   */
  const flyingReactionsByParticipant = reactive<Record<string, FlyingReaction[]>>({});
  let flyingReactionSeq = 0;

  function flyingReactionsFor(participantId: string): FlyingReaction[] {
    return flyingReactionsByParticipant[participantId] ?? [];
  }

  // Первый вызов колбэка — это гидратация ответа на join_room (переход состояния из
  // «ещё не подключились» в реальный снимок стола), а не новая реакция; её пропускаем,
  // иначе при входе/перезагрузке страницы уже стоящие на карточках реакции «вылетали» бы
  // все разом. Реконнект под этот случай не попадает — applyState() не сбрасывает state
  // в null между обрывом и восстановлением связи, так что здесь останется настоящий diff.
  let reactionsHydrated = false;

  watch(
    () => room.reactions,
    (current, previous) => {
      if (!reactionsHydrated) {
        reactionsHydrated = true;
        return;
      }
      const prev = previous ?? [];
      const isSame = (a: Reaction, b: Reaction): boolean =>
        a.fromParticipantId === b.fromParticipantId &&
        a.toParticipantId === b.toParticipantId &&
        a.emoji === b.emoji;
      const added = current.filter((r) => !prev.some((p) => isSame(p, r)));
      for (const r of added) {
        const id = `${Date.now()}-${flyingReactionSeq++}`;
        const list = flyingReactionsByParticipant[r.toParticipantId] ?? [];
        flyingReactionsByParticipant[r.toParticipantId] = [...list, { id, emoji: r.emoji }];
        setTimeout(() => {
          flyingReactionsByParticipant[r.toParticipantId] = (
            flyingReactionsByParticipant[r.toParticipantId] ?? []
          ).filter((f) => f.id !== id);
        }, 1900);
      }
    },
  );

  return { receivedReactionsFor, flyingReactionsFor, onReactClick };
}
