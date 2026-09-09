import pino from 'pino';
import { env } from '../config/index';

/**
 * Structured logging with hard redaction.
 *
 * The redaction list is a privacy control, not a convenience: prompts, code
 * selections and tokens must never reach a log sink. Adding a field that can
 * carry user content without adding it here is a bug.
 */
export const logger = pino({
  level: env().NODE_ENV === 'test' ? 'silent' : env().NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'messages',
      '*.messages',
      'context.selection',
      '*.context.selection',
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken',
      'refreshToken',
      'privyAccessToken',
      'signature',
      '*.privateKey',
    ],
    censor: '[redacted]',
  },
  base: undefined,
});

export type Logger = typeof logger;
