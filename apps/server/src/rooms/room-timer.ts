import { TIMER_DEFAULT_DURATION_SEC, TIMER_DURATION_PRESETS_SEC } from '@estimate/shared';

import { CountdownTimer } from '../platform/realtime';

/**
 * Общий таймер обсуждения раунда — общий таймер отсчёта (`CountdownTimer`) с
 * длительностями комнаты: только пресеты 5/10/15 минут.
 */
export class RoomTimer extends CountdownTimer {
  constructor() {
    super({
      defaultDurationSec: TIMER_DEFAULT_DURATION_SEC,
      isValidDuration: (durationSec) => TIMER_DURATION_PRESETS_SEC.includes(durationSec),
    });
  }
}
