import { inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session';

export type RestrictedArea = 'reports' | 'accounts' | 'settings' | 'users' | 'pos' | 'hrm';

/**
 * Blocks a route before it loads instead of after it renders. The server build is skipped
 * so prerendered pages keep their existing output.
 */
export const restrictTo = (area: RestrictedArea): CanActivateFn => () => {
  if (isPlatformServer(inject(PLATFORM_ID))) return true;
  const router = inject(Router);
  const session = inject(SessionService);
  if (!session.currentUser() || !session.canSee(area)) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
