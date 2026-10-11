/**
 * Присутствие по всем экземплярам сервера (10.18): место сокета хранится в
 * `socket.data`, список собирается через `fetchSockets` канала сущности.
 */
import { describe, expect, it } from 'vitest';

import { ClusterPresence, type PresenceSeat } from '../src/platform/realtime';

interface Identity {
  participantId: string;
  name: string;
}
interface Data {
  room?: PresenceSeat<Identity>;
}

function setup() {
  const presence = new ClusterPresence<Identity, Data>({
    read: (data) => data.room,
    write: (data, seat) => {
      data.room = seat;
    },
  });
  const sockets: Array<{ id: string; data: Data; rooms: Set<string> }> = [];
  const server = {
    in: (room: string) => ({
      fetchSockets: async () => sockets.filter((socket) => socket.rooms.has(room)),
    }),
  };
  function connect(id: string, room: string) {
    const socket = { id, data: {} as Data, rooms: new Set([room]) };
    sockets.push(socket);
    return socket;
  }
  return { presence, server, connect };
}

describe('ClusterPresence', () => {
  it('место сокета читается из socket.data, stand его снимает', () => {
    const { presence, connect } = setup();
    const socket = connect('s1', 'r1');

    expect(presence.seatOf(socket)).toBeNull();
    presence.sit(socket, 'r1', { participantId: 'p1', name: 'Анна' });
    expect(presence.seatOf(socket)).toEqual({
      scopeId: 'r1',
      identity: { participantId: 'p1', name: 'Анна' },
    });
    presence.stand(socket);
    expect(presence.seatOf(socket)).toBeNull();
  });

  it('две вкладки одного человека — одна запись в списке, два сокета в members', async () => {
    const { presence, server, connect } = setup();
    presence.sit(connect('s1', 'r1'), 'r1', { participantId: 'p1', name: 'Анна' });
    presence.sit(connect('s2', 'r1'), 'r1', { participantId: 'p1', name: 'Анна' });
    presence.sit(connect('s3', 'r1'), 'r1', { participantId: 'p2', name: 'Борис' });

    expect((await presence.list(server, 'r1')).map((p) => p.participantId)).toEqual(['p1', 'p2']);
    expect((await presence.members(server, 'r1')).map((m) => m.socketId)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('сокет в канале, но с местом в другой сущности, в список не попадает', async () => {
    const { presence, server, connect } = setup();
    const moving = connect('s1', 'r1');
    presence.sit(moving, 'r2', { participantId: 'p1', name: 'Анна' });

    expect(await presence.list(server, 'r1')).toEqual([]);
  });

  it('сокет с местом, но вне канала (вывели при потере доступа), в список не попадает', async () => {
    const { presence, server, connect } = setup();
    const socket = connect('s1', 'r1');
    presence.sit(socket, 'r1', { participantId: 'p1', name: 'Анна' });
    socket.rooms.delete('r1');

    expect(await presence.list(server, 'r1')).toEqual([]);
  });
});
