import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';

/** One status, counted. Jobs, applications and invitations. */
export interface StatusCount {
  statusId: number;
  statusName: string;
  total: number;

  /** ⚠️ Thirty calendar days in IST, computed in SQL (2.28). */
  last30Days: number;
}

export interface RegistrationCount extends StatusCount {
  userTypeId: number;
  userTypeName: string;
}

export interface ApprovalCount extends StatusCount {
  requestTypeId: number;
  requestTypeName: string;
}

/**
 * 🔴 The number this screen exists for: how long the oldest OPEN request of
 * each type has waited. A queue is judged by its worst case.
 */
export interface QueueWait {
  requestTypeId: number;
  requestTypeName: string;
  stillOpen: number;
  oldestWaitingDays: number;
}

export interface IdentityTotals {
  accounts: number;
  accountsLast30Days: number;
  emailVerified: number;

  /** A live lockout row — NOT the same as status 5 LOCKED. */
  lockedOut: number;
  withFailedAttempts: number;
  asOfIst: string;
}

export interface ApprovalTotals {
  openRequests: number;
  submittedLast30Days: number;
  paymentsAwaiting: number;

  /** 🔴 Here because G31's damage was an error log filling with non-errors. */
  errorLogRows: number;
  asOfIst: string;
}

export interface AppTotals {
  schools: number;
  schoolsVerified: number;
  teachers: number;
  campuses: number;
  openReports: number;
  openEnquiries: number;
  asOfIst: string;
}

export interface AdminAnalytics {
  registrations: RegistrationCount[];
  identity: IdentityTotals;
  approvals: ApprovalCount[];
  waits: QueueWait[];
  approvalTotals: ApprovalTotals;
  jobs: StatusCount[];
  applications: StatusCount[];
  invites: StatusCount[];
  appTotals: AppTotals;
}

/**
 * Platform analytics — one read, three databases. Phase 8-0.
 *
 * ----------------------------------------------------------------------------
 * 🔒 REPORT.VIEW *AND* AN ADMIN USER TYPE
 * ----------------------------------------------------------------------------
 * The permission alone is not the gate, because a school Viewer holds
 * REPORT.VIEW for its own reports. The service requires an admin user type as
 * well — platform totals are not a school's reports with a wider WHERE clause.
 *
 * ⚠️ This service checks neither. The server checks both on every call and the
 * menu row carries the permission; re-checking here would be a second answer
 * to a question the server already answers.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY FIGURE IS COUNTED, NOT READ FROM A COUNTER
 * ----------------------------------------------------------------------------
 * One phase ago the moderation queue projected a denormalised column the
 * product forbids writing, and every advert read "0 applied". The three
 * procedures behind this count rows, and each carries a build guard that fails
 * if a counter column or an identity appears in it.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private readonly dataSignal = signal<AdminAnalytics | null>(null);
  private readonly loadingSignal = signal(false);

  /** 🔴 A failed read is not a platform with no numbers in it. */
  private readonly failedSignal = signal(false);

  readonly data = this.dataSignal.asReadonly();
  readonly isLoading = this.loadingSignal.asReadonly();
  readonly hasFailed = this.failedSignal.asReadonly();

  load(): void {
    this.loadingSignal.set(true);
    this.failedSignal.set(false);

    this.http
      .get<ApiResponse<AdminAnalytics>>(`${this.api.appApiUrl}/admin/desk/analytics`)
      .subscribe({
        next: (response) => {
          this.dataSignal.set(response.data ?? null);
          this.loadingSignal.set(false);
        },
        error: () => {
          this.failedSignal.set(true);
          this.loadingSignal.set(false);
        },
      });
  }
}
