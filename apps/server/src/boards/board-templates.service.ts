import type { BoardTemplate } from '@poker/shared';
import type { BoardTemplatesRepository } from './board-templates.repository';

export class BoardTemplatesService {
  constructor(private readonly repository: BoardTemplatesRepository) {}

  list(): Promise<BoardTemplate[]> {
    return this.repository.listBuiltin();
  }
}
