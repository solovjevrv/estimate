import type { TeamRole } from '@poker/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { TeamsService } from './teams.service';

export interface TeamIdParams {
  id: string;
}

export interface MemberParams extends TeamIdParams {
  userId: string;
}

export interface InviteParams {
  code: string;
}

export interface NameBody {
  name: string;
}

export interface RoleBody {
  role: TeamRole;
}

/** Тонкий слой между HTTP и правилами команд: разбирает запрос и отдаёт результат сервиса */
export class TeamsController {
  constructor(private readonly service: TeamsService) {}

  readonly create = async (
    req: FastifyRequest<{ Body: NameBody }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const team = await this.service.create(req.user.sub, req.body.name);
    return reply.code(201).send({ team });
  };

  readonly list = async (req: FastifyRequest): Promise<unknown> => ({
    teams: await this.service.listForUser(req.user.sub),
  });

  readonly overview = async (req: FastifyRequest<{ Params: TeamIdParams }>): Promise<unknown> =>
    this.service.getOverview(req.user.sub, req.params.id);

  readonly members = async (req: FastifyRequest<{ Params: TeamIdParams }>): Promise<unknown> => ({
    members: await this.service.listMembers(req.user.sub, req.params.id),
  });

  readonly member = async (req: FastifyRequest<{ Params: MemberParams }>): Promise<unknown> => ({
    member: await this.service.getMember(req.user.sub, req.params.id, req.params.userId),
  });

  readonly rename = async (
    req: FastifyRequest<{ Params: TeamIdParams; Body: NameBody }>,
  ): Promise<unknown> => ({
    team: await this.service.rename(req.user.sub, req.params.id, req.body.name),
  });

  readonly remove = async (
    req: FastifyRequest<{ Params: TeamIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.remove(req.user.sub, req.params.id);
    return reply.code(204).send();
  };

  readonly changeMemberRole = async (
    req: FastifyRequest<{ Params: MemberParams; Body: RoleBody }>,
  ): Promise<unknown> => {
    const { member, actorRole } = await this.service.changeMemberRole(
      req.user.sub,
      req.params.id,
      req.params.userId,
      req.body.role,
    );
    // actorRole возвращаем, чтобы клиент сразу увидел своё понижение при передаче владения
    return { member, actorRole };
  };

  readonly removeMember = async (
    req: FastifyRequest<{ Params: MemberParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.removeMember(req.user.sub, req.params.id, req.params.userId);
    return reply.code(204).send();
  };

  readonly rotateInvite = async (
    req: FastifyRequest<{ Params: TeamIdParams }>,
  ): Promise<unknown> => ({
    inviteCode: await this.service.rotateInviteCode(req.user.sub, req.params.id),
  });

  readonly previewInvite = async (
    req: FastifyRequest<{ Params: InviteParams }>,
  ): Promise<unknown> => {
    const team = await this.service.previewInvite(req.params.code);
    return { team: { id: team.id, name: team.name } };
  };

  readonly joinByInvite = async (
    req: FastifyRequest<{ Params: InviteParams }>,
  ): Promise<unknown> => {
    const team = await this.service.joinByInvite(req.user.sub, req.params.code);
    return { team: { id: team.id, name: team.name, createdAt: team.createdAt }, role: team.role };
  };
}
