import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BoardEstimateUpdate, BoardShareRole } from '@estimate/shared';

import type { BoardEstimatesService } from './board-estimates.service';
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

export interface ShareBody {
  role: BoardShareRole | null;
}

export interface EstimateRoomsBody {
  itemIds: string[];
}

/** Разослать новые оценки на доску (15.6) — канал доски живёт в Socket.io */
export type BoardEstimatesNotifier = (boardId: string, updates: BoardEstimateUpdate[]) => void;

export interface ArchivedQuery {
  archived?: 'true' | 'false';
}

/** Тонкий слой между HTTP и правилами досок */
export class BoardsController {
  constructor(
    private readonly service: BoardsService,
    private readonly estimates?: BoardEstimatesService,
    private readonly notifyEstimates: BoardEstimatesNotifier = () => undefined,
  ) {}

  /** Отправить элементы в покер (15.6): по комнате на элемент, существующие — как есть */
  readonly estimateRooms = async (
    req: FastifyRequest<{ Params: BoardIdParams; Body: EstimateRoomsBody }>,
  ): Promise<unknown> => {
    if (!this.estimates) throw new Error('Оценка в покере не подключена');
    const result = await this.estimates.createRooms(req.user.sub, req.params.id, req.body.itemIds);
    if (result.updates.length) this.notifyEstimates(req.params.id, result.updates);
    return { rooms: result.rooms };
  };

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
    boards: await this.service.listAvailable(req.user.sub, req.query.archived === 'true'),
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
    this.service.getSnapshot(req.actorId ?? null, req.params.id);

  readonly rename = async (
    req: FastifyRequest<{ Params: BoardIdParams; Body: TitleBody }>,
  ): Promise<unknown> => ({
    board: await this.service.rename(req.user.sub, req.params.id, req.body.title),
  });

  readonly setShare = async (
    req: FastifyRequest<{ Params: BoardIdParams; Body: ShareBody }>,
  ): Promise<unknown> => ({
    board: await this.service.setShareRole(req.user.sub, req.params.id, req.body.role),
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
