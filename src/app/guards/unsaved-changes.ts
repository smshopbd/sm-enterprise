import { CanDeactivateFn } from '@angular/router';

export interface CanLeave {
  confirmLeave(): boolean | Promise<boolean>;
}

/** Lets a form page ask before the router throws away half-typed work. */
export const unsavedChangesGuard: CanDeactivateFn<CanLeave> = component =>
  component?.confirmLeave ? component.confirmLeave() : true;
