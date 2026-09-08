/** Stable machine-readable error codes. Clients branch on these, never on message text. */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'rate_limited',
  'quota_exceeded',
  'insufficient_credits',
  'plan_forbids_model',
  'ads_unavailable',
  'campaign_not_fundable',
  'payment_unverified',
  'upstream_unavailable',
  'model_busy',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  quota_exceeded: 403,
  insufficient_credits: 403,
  plan_forbids_model: 403,
  ads_unavailable: 503,
  campaign_not_fundable: 409,
  payment_unverified: 402,
  upstream_unavailable: 503,
  model_busy: 429,
  internal_error: 500,
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Thrown by service modules; route handlers translate it into an HTTP response. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    };
  }
}

export const unauthorized = (m = 'Authentication required') => new AppError('unauthorized', m);
export const forbidden = (m = 'Not allowed') => new AppError('forbidden', m);
export const notFound = (m = 'Not found') => new AppError('not_found', m);
