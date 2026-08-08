import { Routes } from '@angular/router';
import { authGuard, guestGuard } from 'jp-shared/core';

import { AdminLayoutComponent } from './layouts/admin-layout.component';

/**
 * Route map for the admin app.
 *
 * ----------------------------------------------------------------------------
 * NO APP PREFIX IN THE PATHS
 * ----------------------------------------------------------------------------
 * These used to be /admin/dashboard, because one application served all three
 * audiences. Now that each has its own deployment the prefix would just repeat
 * the hostname — admin.staffroom.in/admin/dashboard reads like a mistake.
 *
 * ⚠️ The seeded menu rows in database/jp_sso/03_seed/005_seed_menus.sql carry
 * the matching RoutePath. Add a route here and add the row in the same commit;
 * a menu row pointing at a route that does not exist is a 404, and a route with
 * no menu row is invisible.
 *
 * Guard order is deliberate and applies everywhere:
 *
 *   authGuard          -> is there a session at all?
 *   activeAccountGuard -> has the account been approved?
 *   permissionGuard    -> may they perform this specific action?
 *
 * roleGuard is gone: this app serves exactly one user type, and the token's
 * utype is checked by AppAccessService before any route renders.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },

  // ---- public / unauthenticated -------------------------------------------
  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        // Where the emailed reset link lands. Forgot-password without this is a
        // dead end — the mail goes out and arrives nowhere.
        path: 'reset-password',
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordComponent,
          ),
        data: { mode: 'reset' },
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },

  // ---- the app itself ------------------------------------------------------
  {
    path: '',
    canActivate: [authGuard],
    component: AdminLayoutComponent,
    children: [
      { path: 'dashboard', loadComponent: comingSoon, data: { title: 'Dashboard' } },
      { path: 'verification/schools', loadComponent: comingSoon, data: { title: 'School verification' } },
      { path: 'verification/teachers', loadComponent: comingSoon, data: { title: 'Teacher verification' } },
      { path: 'moderation/jobs', loadComponent: comingSoon, data: { title: 'Job moderation' } },
      { path: 'moderation/reports', loadComponent: comingSoon, data: { title: 'Reports' } },
      { path: 'users', loadComponent: comingSoon, data: { title: 'Users' } },
      { path: 'masters', loadComponent: comingSoon, data: { title: 'Master data' } },
      { path: 'cms', loadComponent: comingSoon, data: { title: 'CMS' } },
      { path: 'reports', loadComponent: comingSoon, data: { title: 'Analytics' } },
      { path: 'settings', loadComponent: comingSoon, data: { title: 'Settings' } },
    ],
  },

  // ---- errors --------------------------------------------------------------
  {
    path: 'forbidden',
    loadComponent: () => import('jp-shared/pages').then((m) => m.ForbiddenComponent),
  },
  {
    path: '**',
    loadComponent: () => import('jp-shared/pages').then((m) => m.NotFoundComponent),
  },
];

/** Shared placeholder loader, until each feature lands. */
function comingSoon() {
  return import('jp-shared/pages').then((m) => m.ComingSoonComponent);
}
