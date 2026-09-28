<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { ROOM_NAME_MAX_LENGTH } from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { useAsyncAction } from '../composables/use-async-action';
import { useEntityModal } from '../composables/use-entity-modal';
import EntityTextModal from '../components/EntityTextModal.vue';
import { createRoom as createRoomRequest } from '../features/rooms/api/rooms-api';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const router = useRouter();
const session = useSessionStore();

// Цвета точек — по макету 02_Main: первая на surface-brand, две другие в Figma без
// токенов (декоративные акценты, одинаковые в обеих темах)
const bullets = computed(() => [
  { label: t('home.bullet1'), dotClass: 'bg-surface-brand' },
  { label: t('home.bullet2'), dotClass: 'bg-[#ff8c00]' },
  { label: t('home.bullet3'), dotClass: 'bg-[#e84e5f]' },
]);

const cards = computed(() => [
  {
    title: t('home.card1Title'),
    desc: t('home.card1Desc'),
    icon: 'i-lucide-layers',
  },
  {
    title: t('home.card2Title'),
    desc: t('home.card2Desc'),
    icon: 'i-lucide-refresh-cw',
  },
  {
    title: t('home.card3Title'),
    desc: t('home.card3Desc'),
    icon: 'i-lucide-link-2',
  },
]);

const createRoomModal = useEntityModal();

const toast = useToast();

const { pending: creating, execute: createRoom } = useAsyncAction({
  run: (name: string) => createRoomRequest(name),
  success: async (room) => {
    createRoomModal.close();
    await router.push({ name: 'room', params: { id: room.id } });
  },
  error: () => {
    toast.add({ title: t('room.createError'), color: 'error' });
  },
});

async function onSubmit(name: string): Promise<void> {
  await createRoom(name);
}
</script>

<template>
  <!-- Геометрия — по фреймам 02_Main (Light Guest / Dark Authenticated): бейдж на 56px ниже
       шапки (отступ main), H1 Headings/48, лид Body/Xlarge, иллюстрация 513×269 справа,
       фичи — Card (elevation/3) с Card Content — Feature из кита -->
  <section class="pb-11">
    <div class="flex flex-col items-start gap-10 lg:flex-row lg:gap-0">
      <div class="min-w-0 flex-1">
        <span class="badge-pill badge-pill-primary mb-5 inline-block uppercase">
          {{ t('home.eyebrow') }}
        </span>
        <h1
          class="font-heading text-text-primary max-w-[667px] text-[32px] leading-[40px] font-bold tracking-[-0.03em] text-balance sm:text-[48px] sm:whitespace-pre-line sm:leading-[52px]"
        >
          {{ t('home.headline') }}
        </h1>
        <p
          class="text-text-secondary mt-5 max-w-[520px] sm:mt-11 text-lg leading-[26px] font-medium tracking-[-0.015em]"
        >
          {{ t('home.lead') }}
        </p>

        <div class="mt-10 flex flex-wrap gap-3">
          <template v-if="session.isAuthenticated">
            <UButton size="lg" icon="i-lucide-plus" @click="createRoomModal.show">
              {{ t('room.create') }}
            </UButton>
            <UButton size="lg" color="neutral" variant="outline" to="/teams">
              {{ t('home.startWithTeam') }}
            </UButton>
          </template>
          <UButton v-else size="lg" to="/login">
            {{ t('home.startAsGuest') }}
          </UButton>
        </div>

        <div class="mt-10 flex flex-wrap gap-8">
          <div v-for="bullet in bullets" :key="bullet.label" class="flex items-center gap-2">
            <span class="size-2 shrink-0 rounded-full" :class="bullet.dotClass" />
            <span
              class="text-text-secondary text-sm leading-5 font-medium tracking-[-0.01em] whitespace-pre-line"
              >{{ bullet.label }}</span
            >
          </div>
        </div>
      </div>

      <div
        class="aspect-[513/269] w-full shrink-0 overflow-hidden rounded-r24 lg:mt-[74px] lg:w-[513px]"
      >
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

    <div class="mt-[54px] grid gap-6 sm:grid-cols-3">
      <div
        v-for="card in cards"
        :key="card.title"
        class="bg-surface-block shadow-elevation-3 flex min-h-[214px] flex-col gap-3 rounded-r24 p-8"
      >
        <div class="bg-surface-brand flex size-11 items-center justify-center rounded-r12">
          <UIcon :name="card.icon" class="text-icons-on-brand size-5.5" />
        </div>
        <h3 class="font-heading text-text-primary text-xl leading-7 font-bold tracking-[-0.02em]">
          {{ card.title }}
        </h3>
        <p class="text-text-secondary max-w-[250px] text-xs leading-[18px] font-medium">
          {{ card.desc }}
        </p>
      </div>
    </div>

    <EntityTextModal
      v-model:open="createRoomModal.open"
      :title="t('room.createTitle')"
      :label="t('common.nameLabel')"
      :placeholder="t('room.createNamePlaceholder')"
      :max-length="ROOM_NAME_MAX_LENGTH"
      :required-message="t('common.nameRequired')"
      :too-long-message="t('common.nameTooLong', { max: ROOM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="creating ? t('room.creating') : t('room.create')"
      :pending="creating"
      @submit="onSubmit"
    />
  </section>
</template>
