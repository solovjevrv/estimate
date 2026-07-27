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
  { label: t('home.bullet1'), dotClass: 'bg-primary' },
  { label: t('home.bullet2'), dotClass: 'bg-[var(--brand-amber)]' },
  { label: t('home.bullet3'), dotClass: 'bg-[var(--brand-coral)]' },
]);

const cards = computed(() => [
  {
    title: t('home.card1Title'),
    desc: t('home.card1Desc'),
    icon: 'i-lucide-layers',
    bg: 'bg-primary',
  },
  {
    title: t('home.card2Title'),
    desc: t('home.card2Desc'),
    icon: 'i-lucide-refresh-cw',
    bg: 'bg-[var(--brand-amber)]',
  },
  {
    title: t('home.card3Title'),
    desc: t('home.card3Desc'),
    icon: 'i-lucide-link-2',
    bg: 'bg-[var(--brand-coral)]',
  },
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
  <section class="space-y-16 pt-8 pb-11">
    <div class="flex flex-col items-start gap-10 lg:flex-row lg:items-center">
      <div class="min-w-0 flex-1">
        <span
          class="badge-pill badge-pill-primary mb-5 inline-block tracking-wide uppercase"
          style="padding: 6px 14px"
        >
          {{ t('home.eyebrow') }}
        </span>
        <h1
          class="font-heading max-w-xl font-extrabold text-balance"
          style="font-size: clamp(32px, 4.2vw, 52px); line-height: 1.15; letter-spacing: -0.02em"
        >
          {{ t('home.headline') }}
        </h1>
        <p class="text-muted mt-5 max-w-lg text-lg">{{ t('home.lead') }}</p>

        <div class="mt-9 flex flex-wrap gap-3.5">
          <template v-if="session.isAuthenticated">
            <UButton
              size="lg"
              icon="i-lucide-plus"
              class="px-[26px] py-[15px] text-base font-bold"
              @click="open = true"
            >
              {{ t('room.create') }}
            </UButton>
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              class="px-[26px] py-[15px] text-base font-bold"
              to="/teams"
            >
              {{ t('home.startWithTeam') }}
            </UButton>
          </template>
          <UButton v-else size="lg" class="px-[26px] py-[15px] text-base font-bold" to="/login">
            {{ t('home.startAsGuest') }}
          </UButton>
        </div>

        <div class="mt-10 flex flex-wrap gap-7">
          <div v-for="bullet in bullets" :key="bullet.label" class="flex items-center gap-2">
            <span class="size-2 shrink-0 rounded-full" :class="bullet.dotClass" />
            <span class="text-muted text-sm font-semibold">{{ bullet.label }}</span>
          </div>
        </div>
      </div>

      <div class="aspect-[1108/581] w-full flex-1 overflow-hidden rounded-[24px] lg:w-auto">
        <img
          src="/hero-illustration-light.webp"
          :alt="t('home.illustrationAlt')"
          class="size-full object-cover dark:hidden"
        />
        <img
          src="/hero-illustration-dark.webp"
          :alt="t('home.illustrationAlt')"
          class="hidden size-full object-cover dark:block"
        />
      </div>
    </div>

    <div class="grid gap-6 sm:grid-cols-3">
      <div v-for="card in cards" :key="card.title" class="surface-card p-7">
        <div class="mb-4 flex size-11 items-center justify-center rounded-[12px]" :class="card.bg">
          <UIcon :name="card.icon" class="size-5.5 text-white" />
        </div>
        <h3 class="font-heading mb-2 text-[17px] font-bold">{{ card.title }}</h3>
        <p class="text-muted text-[14.5px] leading-relaxed">{{ card.desc }}</p>
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
