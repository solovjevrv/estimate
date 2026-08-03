import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RoomsService } from './rooms.service';

export interface RoomIdParams {
  id: string;
}

export interface TeamIdParams {
  id: string;
}

export interface CreateRoomBody {
  name: string;
  teamId?: string | null;
}

export interface NameBody {
  name: string;
}

export interface ArchivedQuery {
  archived?: 'true' | 'false';
}

/** Тонкий слой между HTTP и правилами комнат */
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  readonly create = async (
    req: FastifyRequest<{ Body: CreateRoomBody }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const room = await this.service.createRoom(req.user.sub, req.body);
    return reply.code(201).send({ room });
  };

  /** Комната открыта по прямой ссылке, поэтому вход не требуется */
  readonly get = async (req: FastifyRequest<{ Params: RoomIdParams }>): Promise<unknown> => ({
    room: await this.service.getRoom(req.params.id),
  });

  readonly listMine = async (
    req: FastifyRequest<{ Querystring: ArchivedQuery }>,
  ): Promise<unknown> => ({
    rooms: await this.service.listMyRooms(req.user.sub, req.query.archived === 'true'),
  });

  readonly stats = async (req: FastifyRequest): Promise<unknown> => ({
    stats: await this.service.getMyStats(req.user.sub),
  });

  /** История раундов открыта без входа — так же, как и сама комната */
  readonly history = async (req: FastifyRequest<{ Params: RoomIdParams }>): Promise<unknown> => ({
    rounds: await this.service.listRoundHistory(req.params.id),
  });

  readonly listByTeam = async (
    req: FastifyRequest<{ Params: TeamIdParams; Querystring: ArchivedQuery }>,
  ): Promise<unknown> => ({
    rooms: await this.service.listTeamRooms(
      req.user.sub,
      req.params.id,
      req.query.archived === 'true',
    ),
  });

  readonly archive = async (req: FastifyRequest<{ Params: RoomIdParams }>): Promise<unknown> => ({
    room: await this.service.archiveRoom(req.user.sub, req.params.id),
  });

  readonly rename = async (
    req: FastifyRequest<{ Params: RoomIdParams; Body: NameBody }>,
  ): Promise<unknown> => ({
    room: await this.service.renameRoom(req.user.sub, req.params.id, req.body.name),
  });

  readonly remove = async (
    req: FastifyRequest<{ Params: RoomIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.deleteRoomPermanently(req.user.sub, req.params.id);
    return reply.code(204).send();
  };
}
