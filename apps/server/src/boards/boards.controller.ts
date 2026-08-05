import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BoardsService } from './boards.service';

export interface BoardIdParams {
  id: string;
}

export interface TeamIdParams {
  id: string;
}

export interface CreateBoardBody {
  title: string;
  teamId?: string | null;
}

export interface TitleBody {
  title: string;
}

export interface ArchivedQuery {
  archived?: 'true' | 'false';
}

/** Тонкий слой между HTTP и правилами досок */
export class BoardsController {
  constructor(private readonly service: BoardsService) {}

  readonly create = async (
    req: FastifyRequest<{ Body: CreateBoardBody }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const board = await this.service.create(req.user.sub, req.body);
    return reply.code(201).send({ board });
  };

  readonly listMine = async (
    req: FastifyRequest<{ Querystring: ArchivedQuery }>,
  ): Promise<unknown> => ({
    boards: await this.service.listPersonal(req.user.sub, req.query.archived === 'true'),
  });

  readonly listByTeam = async (
    req: FastifyRequest<{ Params: TeamIdParams; Querystring: ArchivedQuery }>,
  ): Promise<unknown> => ({
    boards: await this.service.listForTeam(
      req.user.sub,
      req.params.id,
      req.query.archived === 'true',
    ),
  });

  readonly get = async (req: FastifyRequest<{ Params: BoardIdParams }>): Promise<unknown> =>
    this.service.getSnapshot(req.user.sub, req.params.id);

  readonly rename = async (
    req: FastifyRequest<{ Params: BoardIdParams; Body: TitleBody }>,
  ): Promise<unknown> => ({
    board: await this.service.rename(req.user.sub, req.params.id, req.body.title),
  });

  readonly archive = async (req: FastifyRequest<{ Params: BoardIdParams }>): Promise<unknown> => ({
    board: await this.service.archive(req.user.sub, req.params.id),
  });

  readonly unarchive = async (
    req: FastifyRequest<{ Params: BoardIdParams }>,
  ): Promise<unknown> => ({
    board: await this.service.unarchive(req.user.sub, req.params.id),
  });

  readonly remove = async (
    req: FastifyRequest<{ Params: BoardIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.remove(req.user.sub, req.params.id);
    return reply.code(204).send();
  };
}
