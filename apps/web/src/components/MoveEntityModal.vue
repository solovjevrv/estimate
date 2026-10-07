<script setup lang="ts">
/**
 * «Перенести комнату / доску» (10.24, кит — Modal + Modal Content — Move):
 * «Куда перенести» — «Личная» и команды, где можно завести такое (как при
 * создании); под выбором — что изменится. У доски — сколько комнат оценки
 * (15.6) переедет вместе с ней.
 */
import type { Board, Room } from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCreationTeams } from '../composables/use-creation-teams';
import { countEstimateRooms, moveBoard } from '../features/boards/api/boards-api';
import { moveRoom } from '../features/rooms/api/rooms-api';
import { ApiError } from '../lib/api';
import { moveTargets, type MoveEntityKind, type MoveRequest } from '../lib/move-entity';
import { useSessionStore } from '../stores/session';
import { useTeamsStore } from '../stores/teams';

const props = defineProps<{ request: MoveRequest | null }>();

const emit = defineEmits<{
  'update:request': [value: MoveRequest | null];
  /** Перенесено: что именно и где оно теперь */
  moved: [kind: MoveEntityKind, entity: Room | Board];
}>();

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const teams = useTeamsStore();
const roomTeams = useCreationTeams('admin');
const boardTeams = useCreationTeams('member');

/** Последний запрос — пока окно закрывается, содержимое не должно пропасть */
const entity = ref<MoveRequest | null>(null);
const kind = computed<MoveEntityKind>(() => entity.value?.kind ?? 'room');
const modalOpen = computed({
  get: () => props.request !== null,
  set: (value: boolean) => {
    if (!value) emit('update:request', null);
  },
});

const targets = computed(() => {
  if (!entity.value) return [];
  const teams = kind.value === 'room' ? roomTeams.options.value : boardTeams.options.value;
  // Владельца нет (аккаунт удалён) — личной сделать некому, сервер ответит 409
  return moveTargets(entity.value.teamId, teams, t('move.personal')).filter(
    (target) => target.teamId !== null || entity.value?.ownerId !== null,
  );
});
/**
 * Значение USelect: id команды или PERSONAL. Пустая строка нельзя — Reka Select
 * падает на пустом значении пункта, и окно перестаёт закрываться
 */
const PERSONAL = 'personal';
const selected = ref(PERSONAL);
const pending = ref(false);
const linkedRooms = ref(0);

const items = computed(() =>
  targets.value.map((target) => ({ label: target.label, value: target.teamId ?? PERSONAL })),
);
const target = computed(() =>
  targets.value.find((item) => (item.teamId ?? PERSONAL) === selected.value),
);

watch(
  () => props.request,
  async (request) => {
    if (!request) return;
    entity.value = request;
    linkedRooms.value = 0;
    await roomTeams.ensureLoaded();
    selected.value = targets.value[0]?.teamId ?? PERSONAL;
    if (request.kind === 'board') {
      linkedRooms.value = await countEstimateRooms(request.id).catch(() => 0);
    }
  },
);

function teamName(teamId: string): string | null {
  return teams.list.find((team) => team.id === teamId)?.name ?? null;
}

/** «Оценка спринта 42» — сейчас личная / сейчас в команде «Платформа» */
const description = computed(() => {
  const current = entity.value;
  if (!current) return '';
  const team = current.teamId ? teamName(current.teamId) : null;
  const where = current.teamId
    ? team
      ? t('move.nowInTeam', { team })
      : t('move.nowTeam')
    : t('move.nowPersonal');
  return `«${current.name}» — ${where}`;
});

const caption = computed(() => {
  const choice = target.value;
  if (!choice) return t(kind.value === 'room' ? 'move.nowhereRoom' : 'move.nowhereBoard');
  if (choice.teamId) {
    return t(kind.value === 'room' ? 'move.toTeamRoom' : 'move.toTeamBoard', {
      team: choice.label,
    });
  }
  const mine = entity.value?.ownerId === session.user?.id;
  if (kind.value === 'room') return t(mine ? 'move.toMineRoom' : 'move.toCreatorRoom');
  return t(mine ? 'move.toMineBoard' : 'move.toOwnerBoard');
});

async function submit(): Promise<void> {
  const current = entity.value;
  const choice = target.value;
  if (!current || !choice || pending.value) return;
  pending.value = true;
  try {
    const moved =
      current.kind === 'room'
        ? await moveRoom(current.id, choice.teamId)
        : (await moveBoard(current.id, choice.teamId)).board;
    toast.add({
      title: choice.teamId
        ? t('move.movedToTeam', { team: choice.label })
        : t('move.movedToPersonal'),
      color: 'success',
      icon: 'i-lucide-check',
    });
    emit('moved', current.kind, moved);
    modalOpen.value = false;
  } catch (err) {
    toast.add({
      title: err instanceof ApiError && err.message ? err.message : t('move.error'),
      color: 'error',
    });
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    :title="kind === 'room' ? t('move.titleRoom') : t('move.titleBoard')"
    :description="description"
  >
    <template #body>
      <div data-testid="move-entity-modal" class="flex flex-col gap-3">
        <UFormField
          :label="t('move.destination')"
          :help="caption"
          :ui="{ help: 'text-text-secondary' }"
        >
          <USelect
            v-model="selected"
            data-testid="move-destination"
            :items="items"
            :disabled="items.length === 0"
            class="w-full"
          />
        </UFormField>
        <p
          v-if="kind === 'board' && linkedRooms > 0"
          data-testid="move-linked-rooms"
          class="text-text-secondary text-xs leading-[18px]"
        >
          {{ t(target?.teamId ? 'move.linkedRooms' : 'move.linkedRoomsPersonal', linkedRooms) }}
        </p>
        <div class="mt-1 flex justify-end gap-2.5">
          <UButton color="neutral" variant="outline" @click="modalOpen = false">
            {{ t('common.cancel') }}
          </UButton>
          <UButton data-testid="move-submit" :loading="pending" :disabled="!target" @click="submit">
            {{ t('move.submit') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
