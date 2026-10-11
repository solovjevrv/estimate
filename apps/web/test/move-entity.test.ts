import type { Board, Room } from '@estimate/shared';
import { describe, expect, it } from 'vitest';

import {
  boardMoveRequest,
  hasMoveTarget,
  moveTargets,
  roomMoveRequest,
} from '../src/lib/move-entity';

const teams = [
  { id: 't1', name: 'Платформа' },
  { id: 't2', name: 'Гарантии' },
];

describe('moveTargets (10.24)', () => {
  it('личную — только в команды, где можно заводить такое', () => {
    expect(moveTargets(null, teams, 'Личная')).toEqual([
      { teamId: 't1', label: 'Платформа' },
      { teamId: 't2', label: 'Гарантии' },
    ]);
  });

  it('командную — «Личная» первой и другие команды, текущей в списке нет', () => {
    expect(moveTargets('t1', teams, 'Личная')).toEqual([
      { teamId: null, label: 'Личная' },
      { teamId: 't2', label: 'Гарантии' },
    ]);
  });

  it('личная без подходящих команд — переносить некуда', () => {
    expect(moveTargets(null, [], 'Личная')).toEqual([]);
  });
});

describe('запрос на перенос', () => {
  it('комната — владелец это создатель, доска — владелец доски', () => {
    expect(
      roomMoveRequest({ id: 'r1', name: 'Груминг', teamId: 't1', creatorId: 'u1' } as Room),
    ).toEqual({ kind: 'room', id: 'r1', name: 'Груминг', teamId: 't1', ownerId: 'u1' });
    expect(
      boardMoveRequest({ id: 'b1', title: 'Ретро', teamId: null, ownerId: 'u2' } as Board),
    ).toEqual({ kind: 'board', id: 'b1', name: 'Ретро', teamId: null, ownerId: 'u2' });
  });
});

describe('hasMoveTarget — показывать ли «Перенести…»', () => {
  it('личная без подходящих команд — некуда', () => {
    expect(hasMoveTarget(null, 'u1', [])).toBe(false);
    expect(hasMoveTarget(null, 'u1', teams)).toBe(true);
  });

  it('командная — можно сделать личной, если владелец есть', () => {
    expect(hasMoveTarget('t1', 'u1', [])).toBe(true);
    // Владельца нет — личной не сделать; в своей же команде переносить некуда
    expect(hasMoveTarget('t1', null, [teams[0]!])).toBe(false);
    expect(hasMoveTarget('t1', null, teams)).toBe(true);
  });
});
