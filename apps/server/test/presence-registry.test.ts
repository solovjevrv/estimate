/**
 * Реестр присутствия до 19.9 существовал в двух копиях и не имел ни одного
 * прямого теста — проверялся только косвенно, через ws-тесты комнат и досок.
 * Здесь он проверяется как самостоятельная структура данных: вкладки одного
 * человека, переход между сущностями и освобождение памяти.
 */
import { describe, expect, it } from 'vitest';

import { PresenceRegistry } from '../src/platform/realtime';

interface TestIdentity {
  participantId: string;
  name: string;
}

const ANNA: TestIdentity = { participantId: 'p-anna', name: 'Анна' };
const BORIS: TestIdentity = { participantId: 'p-boris', name: 'Борис' };

function registry(): PresenceRegistry<TestIdentity> {
  return new PresenceRegistry<TestIdentity>();
}

describe('PresenceRegistry: вход и выход', () => {
  it('после входа сокет знает свою сущность и свою личность', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);

    expect(presence.scopeOf('socket-1')).toBe('scope-1');
    expect(presence.identityOf('socket-1')).toEqual(ANNA);
    expect(presence.list('scope-1')).toEqual([ANNA]);
  });

  it('о неизвестном сокете не знает ничего и не падает', () => {
    const presence = registry();

    expect(presence.scopeOf('нет-такого')).toBeNull();
    expect(presence.identityOf('нет-такого')).toBeNull();
    expect(presence.leave('нет-такого')).toBeNull();
    expect(presence.list('нет-такой-сущности')).toEqual([]);
    expect(presence.socketIdsOf('нет-такой-сущности', ANNA.participantId)).toEqual([]);
  });

  it('leave возвращает покинутую сущность и убирает участника из списка', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', BORIS);

    expect(presence.leave('socket-1')).toBe('scope-1');
    expect(presence.list('scope-1')).toEqual([BORIS]);
    expect(presence.scopeOf('socket-1')).toBeNull();
    expect(presence.identityOf('socket-1')).toBeNull();
  });

  it('повторный выход того же сокета уже ничего не находит', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);

    expect(presence.leave('socket-1')).toBe('scope-1');
    expect(presence.leave('socket-1')).toBeNull();
  });
});

describe('PresenceRegistry: несколько вкладок одного человека', () => {
  it('в списке участник один, сколько бы вкладок он ни открыл', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', ANNA);
    presence.join('scope-1', 'socket-3', BORIS);

    expect(presence.list('scope-1')).toEqual([ANNA, BORIS]);
  });

  it('socketIdsOf отдаёт все вкладки участника — кик должен убрать его целиком', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', ANNA);
    presence.join('scope-1', 'socket-3', BORIS);
    // Та же личность в другой сущности не должна попасть в выборку
    presence.join('scope-2', 'socket-4', ANNA);

    expect(presence.socketIdsOf('scope-1', ANNA.participantId)).toEqual(['socket-1', 'socket-2']);
    expect(presence.socketIdsOf('scope-1', BORIS.participantId)).toEqual(['socket-3']);
  });

  it('закрытие одной вкладки не уводит участника со стола', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', ANNA);

    presence.leave('socket-1');

    expect(presence.list('scope-1')).toEqual([ANNA]);
  });

  it('в списке остаётся последняя версия личности: переподключение могло изменить имя или роль', () => {
    const presence = registry();
    const renamed: TestIdentity = { ...ANNA, name: 'Анна Петровна' };
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', renamed);

    expect(presence.list('scope-1')).toEqual([renamed]);
  });
});

describe('PresenceRegistry: переход между сущностями', () => {
  it('вход в новую сущность выводит сокет из прежней', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);

    presence.join('scope-2', 'socket-1', ANNA);

    expect(presence.scopeOf('socket-1')).toBe('scope-2');
    expect(presence.list('scope-1')).toEqual([]);
    expect(presence.list('scope-2')).toEqual([ANNA]);
  });

  it('повторный вход в ту же сущность не задваивает и не теряет участника', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);

    presence.join('scope-1', 'socket-1', ANNA);

    expect(presence.list('scope-1')).toEqual([ANNA]);
    expect(presence.socketIdsOf('scope-1', ANNA.participantId)).toEqual(['socket-1']);
  });
});

describe('PresenceRegistry: память', () => {
  it('опустевшая сущность выкидывается целиком', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);
    presence.join('scope-1', 'socket-2', BORIS);
    presence.join('scope-2', 'socket-3', ANNA);

    expect(presence.activeScopes).toBe(2);

    presence.leave('socket-1');
    expect(presence.activeScopes).toBe(2);

    presence.leave('socket-2');
    expect(presence.activeScopes).toBe(1);

    presence.leave('socket-3');
    expect(presence.activeScopes).toBe(0);
  });

  it('переход между сущностями не оставляет пустую запись о прежней', () => {
    const presence = registry();
    presence.join('scope-1', 'socket-1', ANNA);

    presence.join('scope-2', 'socket-1', ANNA);

    expect(presence.activeScopes).toBe(1);
  });
});
