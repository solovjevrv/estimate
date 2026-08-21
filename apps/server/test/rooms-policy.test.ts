import { describe, expect, it } from 'vitest';

import { resolveRoomRole } from '../src/rooms/rooms.policy';

describe('resolveRoomRole', () => {
  it('даёт роль скрам-мастера создателю комнаты и администратору команды', () => {
    expect(resolveRoomRole('owner', 'owner', null)).toBe('scrum_master');
    expect(resolveRoomRole('owner', 'admin', 'admin')).toBe('scrum_master');
  });

  it('оставляет участника команды и гостя голосующими', () => {
    expect(resolveRoomRole('owner', 'member', 'member')).toBe('voter');
    expect(resolveRoomRole('owner', null, null)).toBe('voter');
    expect(resolveRoomRole(null, null, null)).toBe('voter');
  });
});
