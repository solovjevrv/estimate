/**
 * Звук по истечении таймера доски (15.3). По умолчанию выключен: включает
 * каждый сам в поповере таймера, выбор запоминается в браузере. Сигнал
 * синтезируется Web Audio — без аудиофайла в сборке.
 */
const STORAGE_KEY = 'estimate-board-timer-sound';

export function isTimerSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setTimerSoundEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, 'on');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

/** Три коротких сигнала. Браузер может не дать звук без жеста пользователя — тогда тихо */
export function playTimerSound(): void {
  const AudioContextClass = globalThis.AudioContext as typeof AudioContext | undefined;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const start = context.currentTime;
    for (let beep = 0; beep < 3; beep += 1) {
      const at = start + beep * 0.3;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.22);
    }
    setTimeout(() => void context.close(), 1200);
  } catch {
    // no-op: звук — необязательная часть сигнала, тост показывается и без него
  }
}
