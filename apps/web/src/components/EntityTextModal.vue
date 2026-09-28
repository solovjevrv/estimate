<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { trimText } from '@estimate/shared';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { CreationTeam } from '../composables/use-creation-teams';
import { nextEntityModalValue } from '../lib/entity-text-modal';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    label: string;
    submitLabel: string;
    cancelLabel: string;
    requiredMessage: string;
    tooLongMessage: string;
    maxLength: number;
    initialValue?: string;
    placeholder?: string;
    pending?: boolean;
    errorMessage?: string;
    /**
     * Окно создания (DS-063): команды, где можно создать комнату/доску. Пусто — окно
     * без переключателя «Командная» (только название, как у переименования).
     */
    teams?: CreationTeam[];
    /** Команда по умолчанию — со страницы команды; иначе первая из списка */
    defaultTeamId?: string | null;
    /** Подпись переключателя: «Командная комната» / «Командная доска» */
    teamSwitchLabel?: string;
    /** Под выключенным переключателем — что будет создано: «Будет создана личная комната» */
    personalDescription?: string;
  }>(),
  {
    initialValue: '',
    placeholder: '',
    pending: false,
    errorMessage: '',
    teams: () => [],
    defaultTeamId: null,
    teamSwitchLabel: '',
    personalDescription: '',
  },
);

const emit = defineEmits<{
  'update:open': [value: boolean];
  /** teamId — выбранная команда; null — личная (или окно без выбора команды) */
  submit: [value: string, teamId: string | null];
}>();

const modalOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});
const { t } = useI18n();

const state = reactive({ value: '', team: false, teamId: '' });

/**
 * Переключатель «Командная» по умолчанию включён (решение пользователя, DS-063).
 * Команда — со страницы команды, если она среди доступных, иначе первая.
 */
function resetTeam(): void {
  state.team = props.teams.length > 0;
  const preferred = props.teams.find((team) => team.id === props.defaultTeamId);
  state.teamId = (preferred ?? props.teams[0])?.id ?? '';
}

watch(
  () => props.open,
  (isOpen) => {
    state.value = nextEntityModalValue(isOpen, props.initialValue, state.value);
    if (isOpen) resetTeam();
  },
);

// Список команд мог догрузиться уже при открытом окне — выбранной нет среди них
watch(
  () => props.teams,
  () => {
    if (props.open && !props.teams.some((team) => team.id === state.teamId)) resetTeam();
  },
);

const teamItems = computed(() => props.teams.map((team) => ({ label: team.name, value: team.id })));

/**
 * Под переключателем — куда попадёт: выключен — «личная», одна команда — её
 * название (выбора нет); несколько команд — видно по полю выбора ниже.
 */
const teamSwitchDescription = computed(() => {
  if (!state.team) return props.personalDescription || undefined;
  if (props.teams.length === 1) return t('common.teamOf', { name: props.teams[0]!.name });
  return undefined;
});

function validate(form: { value: string }): FormError[] {
  const value = trimText(form.value);
  if (!value) return [{ name: 'value', message: props.requiredMessage }];
  if (value.length > props.maxLength) return [{ name: 'value', message: props.tooLongMessage }];
  return [];
}

function onSubmit(event: FormSubmitEvent<{ value: string }>): void {
  const teamId = props.teams.length > 0 && state.team ? state.teamId || null : null;
  emit('submit', trimText(event.data.value), teamId);
}
</script>

<template>
  <UModal v-model:open="modalOpen" :title="title">
    <template #body>
      <!-- 27_Modal: поля через 12, кнопки — через 16 от тела -->
      <!-- validate-on только input: по умолчанию UForm проверяет и на blur — пустое поле
           краснело «Введите название», стоило увести фокус или нажать «Отмена»
           (закрытие тоже снимает фокус). Пустую отправку ловит проверка на submit -->
      <UForm
        :state="state"
        :validate="validate"
        :validate-on="['input']"
        class="flex flex-col gap-3"
        @submit="onSubmit"
      >
        <UAlert
          v-if="errorMessage"
          icon="i-lucide-circle-alert"
          color="error"
          variant="subtle"
          :description="errorMessage"
        />
        <UFormField :label="label" name="value">
          <UInput
            v-model="state.value"
            :placeholder="placeholder"
            :maxlength="maxLength"
            autofocus
            class="w-full"
          />
        </UFormField>
        <template v-if="teams.length > 0">
          <USwitch
            v-model="state.team"
            :label="teamSwitchLabel"
            :description="teamSwitchDescription"
          />
          <UFormField v-if="state.team && teams.length > 1" :label="t('common.team')" name="teamId">
            <USelect v-model="state.teamId" :items="teamItems" class="w-full" />
          </UFormField>
        </template>
        <div class="mt-1 flex justify-end gap-2.5">
          <UButton color="neutral" variant="outline" @click="modalOpen = false">
            {{ cancelLabel }}
          </UButton>
          <UButton type="submit" :loading="pending">
            {{ submitLabel }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
