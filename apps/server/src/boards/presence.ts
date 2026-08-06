/** Кто сейчас смотрит доску. Доски не поддерживают гостей — участник всегда авторизован (12.4) */
export interface BoardParticipantIdentity {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Присутствие на доске. Живёт в памяти процесса — как `RoomPresence` у комнат:
 * список зрителей сиюминутен, в базе хранятся только сами элементы/связи. При
 * нескольких инстансах сюда понадобится общий адаптер (см. Epic 8/7.12).
 */
export class BoardPresence {
  private readonly participantsByBoard = new Map<string, Map<string, BoardParticipantIdentity>>();
  private readonly boardBySocket = new Map<string, string>();

  join(boardId: string, socketId: string, identity: BoardParticipantIdentity): void {
    this.leave(socketId);
    const board =
      this.participantsByBoard.get(boardId) ?? new Map<string, BoardParticipantIdentity>();
    board.set(socketId, identity);
    this.participantsByBoard.set(boardId, board);
    this.boardBySocket.set(socketId, boardId);
  }

  /** Возвращает доску, из которой ушёл сокет, или null — если он никуда не входил */
  leave(socketId: string): string | null {
    const boardId = this.boardBySocket.get(socketId);
    if (!boardId) {
      return null;
    }
    this.boardBySocket.delete(socketId);
    const board = this.participantsByBoard.get(boardId);
    board?.delete(socketId);
    if (board && board.size === 0) {
      this.participantsByBoard.delete(boardId);
    }
    return boardId;
  }

  boardOf(socketId: string): string | null {
    return this.boardBySocket.get(socketId) ?? null;
  }

  identityOf(socketId: string): BoardParticipantIdentity | null {
    const boardId = this.boardBySocket.get(socketId);
    if (!boardId) {
      return null;
    }
    return this.participantsByBoard.get(boardId)?.get(socketId) ?? null;
  }

  /** Зрители доски без дублей: один человек мог открыть доску в двух вкладках */
  list(boardId: string): BoardParticipantIdentity[] {
    const board = this.participantsByBoard.get(boardId);
    if (!board) {
      return [];
    }
    const unique = new Map<string, BoardParticipantIdentity>();
    for (const identity of board.values()) {
      unique.set(identity.userId, identity);
    }
    return [...unique.values()];
  }
}
