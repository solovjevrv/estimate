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

  readonly listMine = async (req: FastifyRequest): Promise<unknown> => ({
    rooms: await this.service.listMyRooms(req.user.sub),
  });

  readonly listByTeam = async (
    req: FastifyRequest<{ Params: TeamIdParams }>,
  ): Promise<unknown> => ({
    rooms: await this.service.listTeamRooms(req.user.sub, req.params.id),
  });

  readonly close = async (req: FastifyRequest<{ Params: RoomIdParams }>): Promise<unknown> => ({
    room: await this.service.closeRoom(req.user.sub, req.params.id),
  });
}
