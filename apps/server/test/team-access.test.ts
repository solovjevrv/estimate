/**
 * Права по членству в команде проверялись только косвенно — через маршруты
 * комнат, досок и команд. Здесь проверяется сама развилка: она одна на все три
 * домена, и её ошибка означает не косметический баг, а дырку в доступе.
 */
import type { TeamRole } from '@estimate/shared';
import { describe, expect, it, vi } from 'vitest';

import { type Membership, TeamAccess, requireRole } from '../src/access';
import { ForbiddenError, NotFoundError } from '../src/errors';
import type { TeamsRepository } from '../src/teams';

const TEAM_ID = 'team-1';
const ACTOR_ID = 'user-1';

function membership(role: TeamRole): Membership {
  return { teamId: TEAM_ID, userId: ACTOR_ID, role };
}

/** Доступ поверх репозитория-заглушки: настоящая база для правил прав не нужна */
function accessWith(found: Membership | null): {
  access: TeamAccess;
  findMembership: ReturnType<typeof vi.fn>;
} {
  const findMembership = vi.fn(async () => found);
  const access = new TeamAccess({ findMembership } as unknown as TeamsRepository);
  return { access, findMembership };
}

describe('requireRole', () => {
  it('старшая роль проходит там, где требуется младшая', () => {
    expect(requireRole(membership('admin'), 'member').role).toBe('admin');
    expect(requireRole(membership('admin'), 'guest').role).toBe('admin');
    expect(requireRole(membership('member'), 'guest').role).toBe('member');
  });

  it('роль, равная требуемой, проходит', () => {
    expect(requireRole(membership('member'), 'member').role).toBe('member');
    expect(requireRole(membership('guest'), 'guest').role).toBe('guest');
  });

  it('младшая роль получает 403 и текст вызывающего', () => {
    expect(() => requireRole(membership('member'), 'admin', 'Только администратор')).toThrow(
      ForbiddenError,
    );
    expect(() => requireRole(membership('member'), 'admin', 'Только администратор')).toThrow(
      'Только администратор',
    );
    expect(() => requireRole(membership('guest'), 'member')).toThrow(ForbiddenError);
  });

  it('отсутствие членства — это 404, а не 403: иначе по ответу можно перебрать чужие команды', () => {
    expect(() => requireRole(null, 'guest')).toThrow(NotFoundError);
    expect(() => requireRole(null, 'guest')).toThrow('Команда не найдена');
  });
});

describe('TeamAccess.require', () => {
  it('возвращает членство, когда роли хватает', async () => {
    const { access, findMembership } = accessWith(membership('admin'));

    await expect(access.require(TEAM_ID, ACTOR_ID, 'admin')).resolves.toEqual(membership('admin'));
    expect(findMembership).toHaveBeenCalledWith(TEAM_ID, ACTOR_ID);
  });

  it('чужая команда и недостаточная роль различаются кодом ответа', async () => {
    await expect(
      accessWith(null).access.require(TEAM_ID, ACTOR_ID, 'guest'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      accessWith(membership('guest')).access.require(TEAM_ID, ACTOR_ID, 'admin'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('неавторизованный не считается участником и в базу за этим не ходит', async () => {
    const { access, findMembership } = accessWith(membership('admin'));

    await expect(access.require(TEAM_ID, null, 'guest')).rejects.toBeInstanceOf(NotFoundError);
    expect(findMembership).not.toHaveBeenCalled();
  });
});

describe('TeamAccess.isAtLeast', () => {
  it('отвечает без исключения: недостаток прав здесь не ошибка, а другой уровень доступа', async () => {
    await expect(
      accessWith(membership('admin')).access.isAtLeast(TEAM_ID, ACTOR_ID, 'admin'),
    ).resolves.toBe(true);
    await expect(
      accessWith(membership('member')).access.isAtLeast(TEAM_ID, ACTOR_ID, 'admin'),
    ).resolves.toBe(false);
  });

  it('не-участник и гость получают false, а не падение', async () => {
    await expect(accessWith(null).access.isAtLeast(TEAM_ID, ACTOR_ID, 'guest')).resolves.toBe(
      false,
    );
    await expect(
      accessWith(membership('admin')).access.isAtLeast(TEAM_ID, null, 'guest'),
    ).resolves.toBe(false);
  });
});

describe('TeamAccess.membershipOf', () => {
  it('отдаёт членство как есть — уровень доступа из него считает домен', async () => {
    await expect(
      accessWith(membership('member')).access.membershipOf(TEAM_ID, ACTOR_ID),
    ).resolves.toEqual(membership('member'));
    await expect(accessWith(null).access.membershipOf(TEAM_ID, ACTOR_ID)).resolves.toBeNull();
  });
});
