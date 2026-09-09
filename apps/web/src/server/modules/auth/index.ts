import { AppError } from '@aam/shared';
import { bearerToken } from '../../lib/http';
import { getUser, hasRole, type UserWithProfile } from '../users/service';
import { verifyAccessToken, type SessionClaims } from './session';

export * from './session';
export * from './privy';
export * from './vscode-handoff';

export interface AuthenticatedRequest {
  claims: SessionClaims;
  user: UserWithProfile;
}

/** Resolves the caller, or throws 401. Every non-public route starts here. */
export async function authenticate(request: Request): Promise<AuthenticatedRequest> {
  const token = bearerToken(request);
  if (!token) throw new AppError('unauthorized', 'Authentication required');

  const claims = await verifyAccessToken(token);
  const user = await getUser(claims.userId);
  return { claims, user };
}

export async function requireRole(request: Request, role: string): Promise<AuthenticatedRequest> {
  const auth = await authenticate(request);
  if (!hasRole(auth.user, role)) {
    throw new AppError('forbidden', `This action requires the ${role} role`);
  }
  return auth;
}
