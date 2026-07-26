<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { ROOM_NAME_MAX_LENGTH } from '@poker/shared';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { useRoomsStore } from '../stores/rooms';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const router = useRouter();
const session = useSessionStore();
const rooms = useRoomsStore();

const bullets = computed(() => [
  { label: t('home.bullet1'), color: 'var(--ui-color-primary-500)' },
  { label: t('home.bullet2'), color: 'var(--brand-amber)' },
  { label: t('home.bullet3'), color: 'var(--brand-coral)' },
]);

const featureCards = computed(() => [
  { title: t('home.card1Title'), desc: t('home.card1Desc'), color: 'var(--ui-color-primary-500)' },
  { title: t('home.card2Title'), desc: t('home.card2Desc'), color: 'var(--brand-amber)' },
  { title: t('home.card3Title'), desc: t('home.card3Desc'), color: 'var(--brand-coral)' },
]);

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
  <section class="space-y-16">
    <div class="grid items-center gap-14 lg:grid-cols-2">
      <div>
        <span
          class="bg-primary/10 text-primary mb-5 inline-block rounded-full px-3.5 py-1.5 text-[13px] font-bold"
        >
          {{ t('home.eyebrow') }}
        </span>
        <h1
          class="font-heading mb-5 text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl"
        >
          {{ t('home.headline') }}
        </h1>
        <p class="text-muted mb-8 max-w-lg text-lg">{{ t('home.lead') }}</p>

        <div class="mb-9 flex flex-wrap gap-3">
          <template v-if="session.isAuthenticated">
            <UButton size="lg" icon="i-lucide-plus" @click="open = true">
              {{ t('room.create') }}
            </UButton>
            <UButton size="lg" color="neutral" variant="outline" to="/teams">
              {{ t('home.startWithTeam') }}
            </UButton>
          </template>
          <UButton v-else size="lg" to="/login">{{ t('home.startAsGuest') }}</UButton>
        </div>

        <div class="flex flex-wrap gap-6">
          <div
            v-for="bullet in bullets"
            :key="bullet.label"
            class="flex items-center gap-2 text-sm font-semibold"
          >
            <span class="size-2 shrink-0 rounded-full" :style="{ background: bullet.color }" />
            <span class="text-muted">{{ bullet.label }}</span>
          </div>
        </div>
      </div>

      <div class="bg-primary/5 aspect-4/3 hidden items-center justify-center rounded-3xl lg:flex">
        <div class="relative h-32 w-44">
          <div
            class="absolute top-2 left-6 h-28 w-20 -rotate-6 rounded-2xl shadow-lg"
            style="background: var(--brand-amber)"
          />
          <div
            class="absolute top-4 left-16 h-28 w-20 rotate-3 rounded-2xl shadow-lg"
            style="background: var(--brand-blue)"
          />
          <div
            class="text-primary bg-default absolute top-0 left-0 flex h-28 w-20 -rotate-12 items-center justify-center rounded-2xl text-2xl font-extrabold shadow-xl"
          >
            8
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-6 sm:grid-cols-3">
      <div v-for="card in featureCards" :key="card.title" class="surface-card p-7">
        <div class="mb-4 size-11 rounded-xl" :style="{ background: card.color }" />
        <div class="font-heading mb-2 text-lg font-bold">{{ card.title }}</div>
        <p class="text-muted text-sm leading-relaxed">{{ card.desc }}</p>
      </div>
    </div>

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
