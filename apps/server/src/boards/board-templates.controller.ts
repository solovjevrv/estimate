import type { BoardTemplatesService } from './board-templates.service';

export class BoardTemplatesController {
  constructor(private readonly service: BoardTemplatesService) {}

  readonly list = async (): Promise<unknown> => ({
    templates: await this.service.list(),
  });
}
