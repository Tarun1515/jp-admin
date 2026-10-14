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
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        data: { title: 'Dashboard' },
      },

      /*
        The two verification queues are ONE component with different route
        data, not two components and not a tab held in a signal.

        Tabs that live in component state break the back button, cannot be
        bookmarked, and cannot be linked to from an email — and the seeded menu
        rows point at these two paths, so they have to be real routes anyway.
      */
      {
        path: 'verification/schools',
        loadComponent: () =>
          import('./features/verification/queue/verification-queue.component').then(
            (m) => m.VerificationQueueComponent,
          ),
        data: { title: 'School verification', tab: 'schools' },
      },
      {
        path: 'verification/teachers',
        loadComponent: () =>
          import('./features/verification/queue/verification-queue.component').then(
            (m) => m.VerificationQueueComponent,
          ),
        data: { title: 'Teacher verification', tab: 'teachers' },
      },
      {
        // Not in the menu, and should not be: it is where the queue goes, not
        // somewhere anybody navigates to on its own.
        path: 'verification/requests/:id',
        loadComponent: () =>
          import('./features/verification/detail/request-detail.component').then(
            (m) => m.RequestDetailComponent,
          ),
        data: { title: 'Verification request' },
      },
      /*
        Phase 2.5 — the entitlement matrix.

        ⚠️ Gated on SETTINGS.MANAGE on the SERVER. There is no permissionGuard
        here because hiding a route is presentation: the menu row carries the
        same permission, so a person without it never sees the link, and if they
        type the URL the API refuses. Protection is the API's job.
      */
      {
        path: 'settings/plans',
        loadComponent: () =>
          import('./features/entitlements/matrix/entitlement-matrix.component').then(
            (m) => m.EntitlementMatrixComponent,
          ),
        data: { title: 'Plans and features' },
      },

      /*
        Phase 6.5B — the payments queue.

        🔴 Gated on PAYMENT.VERIFY on the SERVER, and there is no
        permissionGuard here for the same reason 'settings/plans' has none:
        hiding a route is presentation. The seeded menu row carries the same
        permission, so nobody without it sees the link — and if they type the
        URL, every call the screen makes is refused 403. Protection is the
        API's job.

        ⚠️ A DIFFERENT SCREEN FROM /billing in the school and teacher portals,
        not a shared one. "What plan am I on" and "everyone's payments awaiting
        confirmation" are two jobs that happen to involve the same table;
        sharing a component between them would be sharing a name.
      */
      {
        path: 'billing/payments',
        loadComponent: () =>
          import('./features/billing/payments/payments-queue.component').then(
            (m) => m.PaymentsQueueComponent,
          ),
        data: { title: 'Payments' },
      },

      /*
        Phase 7B — THE ADMIN OPERATIONS DESK, six screens over five surfaces.

        🔒 Gated on the SERVER, the same way 'settings/plans' and
        'billing/payments' are, and for the same stated reason: hiding a route
        is presentation. MODERATION.JOB, MODERATION.REPORT, CMS.MANAGE and
        ENQUIRY.MANAGE are checked in AdminDeskService on every call, and the
        seeded menu rows carry the same four codes — so a person without one
        never sees the link, and typing the URL yields a screen whose every
        request is refused 403.

        ⚠️ SIX ROUTES, NOT TABS. The CMS screens could have been one page with
        three tabs; tabs held in a signal break the back button, cannot be
        bookmarked and cannot be linked to from an email. 005_seed_menus.sql
        carries a row per path, added in this same commit.
      */
      {
        path: 'moderation/jobs',
        loadComponent: () =>
          import('./features/moderation/jobs/job-moderation.component').then(
            (m) => m.JobModerationComponent,
          ),
        data: { title: 'Job moderation' },
      },
      {
        path: 'moderation/reports',
        loadComponent: () =>
          import('./features/moderation/reports/report-queue.component').then(
            (m) => m.ReportQueueComponent,
          ),
        data: { title: 'Reports' },
      },
      {
        path: 'enquiries',
        loadComponent: () =>
          import('./features/enquiries/enquiry-queue.component').then(
            (m) => m.EnquiryQueueComponent,
          ),
        data: { title: 'Enquiries' },
      },
      {
        path: 'cms/featured',
        loadComponent: () =>
          import('./features/cms/featured/featured-placement.component').then(
            (m) => m.FeaturedPlacementComponent,
          ),
        data: { title: 'Featured placement' },
      },
      {
        path: 'cms/faqs',
        loadComponent: () =>
          import('./features/cms/faqs/faq-admin.component').then((m) => m.FaqAdminComponent),
        data: { title: 'FAQs' },
      },
      {
        path: 'cms/blocks',
        loadComponent: () =>
          import('./features/cms/blocks/content-blocks.component').then(
            (m) => m.ContentBlocksComponent,
          ),
        data: { title: 'Page content' },
      },

      /*
        ⚠️ /cms WAS a real route (the coming-soon placeholder) and its menu row
        pointed at it, so it stays — as a redirect. Deleting it would 404 every
        bookmark and every link in a handover document written before today.
      */
      { path: 'cms', pathMatch: 'full', redirectTo: 'cms/featured' },

      { path: 'users', loadComponent: comingSoon, data: { title: 'Users' } },
      { path: 'masters', loadComponent: comingSoon, data: { title: 'Master data' } },
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
