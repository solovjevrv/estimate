import type { FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors';

import { ACCESS_COOKIE, type TokenService } from './token.service';

/** preHandler: пускает дальше только с валидной access-кукой */
export class Authenticator {
  constructor(private readonly tokens: TokenService) {}

  readonly handle = async (req: FastifyRequest): Promise<void> => {
    const token = req.cookies[ACCESS_COOKIE];
    const userId = token ? this.tokens.verify(token, 'access') : null;
    if (!userId) {
      throw new UnauthorizedError();
    }
    req.user = { sub: userId, typ: 'access' };
  };
}
