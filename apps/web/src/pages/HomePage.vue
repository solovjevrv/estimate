<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { FIBONACCI_DECK, ROOM_NAME_MAX_LENGTH } from '@poker/shared';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { useRoomsStore } from '../stores/rooms';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const router = useRouter();
const session = useSessionStore();
const rooms = useRoomsStore();

const open = ref(false);
const creating = ref(false);
const state = reactive({ name: '' });

watch(open, (isOpen) => {
  if (!isOpen) state.name = '';
});

function validate(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('teams.nameRequired') });
  } else if (name.length > ROOM_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('teams.nameTooLong', { max: ROOM_NAME_MAX_LENGTH }) });
  }
  return errors;
}

const toast = useToast();

async function onSubmit(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  creating.value = true;
  try {
    const room = await rooms.create(event.data.name.trim());
    open.value = false;
    await router.push({ name: 'room', params: { id: room.id } });
  } catch {
    toast.add({ title: t('room.createError'), color: 'error' });
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">{{ t('app.name') }}</h1>
      <p class="text-muted">{{ t('app.tagline') }}</p>
    </div>

    <p>{{ t('home.lead') }}</p>
    <p class="text-muted text-sm">{{ t('home.deck', { cards: FIBONACCI_DECK.join(', ') }) }}</p>

    <div v-if="session.isAuthenticated" class="flex flex-wrap gap-2">
      <UButton to="/teams">{{ t('home.startWithTeam') }}</UButton>
      <UButton icon="i-lucide-plus" color="neutral" variant="subtle" @click="open = true">
        {{ t('room.create') }}
      </UButton>
    </div>
    <UButton v-else to="/login">{{ t('home.startAsGuest') }}</UButton>

    <UModal v-model:open="open" :title="t('room.createTitle')">
      <template #body>
        <UForm :state="state" :validate="validate" class="space-y-4" @submit="onSubmit">
          <UFormField :label="t('teams.nameLabel')" name="name">
            <UInput
              v-model="state.name"
              :placeholder="t('room.createNamePlaceholder')"
              :maxlength="ROOM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :loading="creating">
              {{ creating ? t('room.creating') : t('room.create') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </section>
</template>
