import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * One account, exactly as `GET /api/users` returns it.
 *
 * ⚠️ EVERY FIELD IS ALREADY camelCase ON THE WIRE. The 2.61 hazard is on the
 * SQL side — `Is_Active AS IsActive` — and `USP_GetUserList` aliases there, so
 * nothing needs renaming here. Checked against a live response rather than
 * assumed, because G25 was exactly this bug going unnoticed.
 */
export interface AdminAccount {
  userUid: string;
  userTypeId: number;
  userTypeName: string;
  statusId: number;
  statusCode: string;
  statusName: string;
  email: string;
  mobile: string | null;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  organizationUid: string | null;
  lastLoginOnUtc: string | null;

  /** Failed sign-ins since the last success. A lockout signal, not a judgement. */
  failedAttemptCount: number;
  createdOnUtc: string;

  /**
   * 🔴 ECHOED BACK ON A STATUS CHANGE, and the server refuses a stale one with
   * CONCURRENCY_CONFLICT. Two administrators acting on the same account is the
   * case this exists for.
   */
  rowVersion: number;
}

export interface AccountPage {
  rows: AdminAccount[];
  totalRecords: number;
}

/**
 * The accounts an administrator can search and act on. Phase 8-0.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE BACKEND FOR THIS WAS ALREADY COMPLETE
 * ----------------------------------------------------------------------------
 * `GET /api/users` has taken a search term, a user type, a status, a date
 * range, a sort and paging since 2E — the parameter is in `USP_GetUserList`
 * AND in `UserRepository`, so nothing was missing but a screen. 8-0 checked
 * that before writing anything, which is why this service is thin.
 *
 * ----------------------------------------------------------------------------
 * 🔒 USER.MANAGE, AND THIS SERVICE CHECKS NOTHING
 * ----------------------------------------------------------------------------
 * The server checks it on every call and the seeded menu row carries the same
 * code. Re-checking here would be a second answer to a question the server
 * already answers (the reasoning AppConstants records for job permissions).
 *
 * ⚠️ `GET /api/users` is NOT admin-only in itself: a school member sees their
 * own organisation's team through it (the service scopes by the token's
 * organisation, never by the request). An administrator sees everything. That
 * is one endpoint with two audiences, and the scoping is the server's.
 */
@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private get base(): string {
    return `${this.api.ssoApiUrl}/users`;
  }

  private readonly rowsSignal = signal<AdminAccount[]>([]);
  private readonly totalSignal = signal(0);
  private readonly loadingSignal = signal(false);

  /** 🔴 A failed read is not an empty platform. */
  private readonly failedSignal = signal(false);

  readonly rows = this.rowsSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();
  readonly isLoading = this.loadingSignal.asReadonly();
  readonly hasFailed = this.failedSignal.asReadonly();

  load(filter: {
    search?: string | null;
    userTypeId?: number | null;
    statusId?: number | null;
    pageNumber?: number;
    pageSize?: number;
  } = {}): void {
    this.loadingSignal.set(true);
    this.failedSignal.set(false);

    let params = new HttpParams()
      .set('pageNumber', String(filter.pageNumber ?? 1))
      .set('pageSize', String(filter.pageSize ?? 20));

    if (filter.search) params = params.set('search', filter.search);
    if (filter.userTypeId) params = params.set('userTypeId', String(filter.userTypeId));
    if (filter.statusId) params = params.set('statusId', String(filter.statusId));

    this.http.get<ApiResponse<AdminAccount[]>>(this.base, { params }).subscribe({
      next: (response) => {
        this.rowsSignal.set(response.data ?? []);
        this.totalSignal.set(response.totalRecords ?? 0);
        this.loadingSignal.set(false);
      },
      error: () => {
        this.failedSignal.set(true);
        this.loadingSignal.set(false);
      },
    });
  }

  /**
   * Approve, reject, suspend or reactivate.
   *
   * 🔴 THE REASON IS ONLY STORED FOR A SUSPENSION, AND THE SCREEN SAYS SO.
   * `USP_UpdateUserStatus` writes it into `t_sso_user_lockouts` when the new
   * status is SUSPENDED (4) — so the person reading "why can I not sign in"
   * finds the administrator and the reason in one place. On every other
   * transition the parameter is accepted and discarded; there is no status
   * history table (G45).
   *
   * ⚠️ So this screen asks for a reason where it lands and not where it does
   * not. Collecting a note the product throws away is the contact form's
   * `role` field again — 7A removed that rather than storing it nowhere.
   */
  updateStatus(
    account: AdminAccount,
    newStatusId: number,
    remarks: string | null,
  ): Observable<string> {
    return this.http
      .put<ApiResponse<null>>(`${this.base}/${account.userUid}/status`, {
        newStatusId,
        rowVersion: account.rowVersion,
        remarks,
      })
      .pipe(map((r) => r.message));
  }

  /**
   * Lift a lockout before it expires on its own.
   *
   * ⚠️ A LOCKOUT IS NOT A STATUS. It comes from failed sign-ins and clears
   * itself; status 5 LOCKED exists but `USP_UpdateUserStatus` refuses to be
   * given it ("use suspend rather than lock for an administrative action"), so
   * the two never get confused. This is the only way to clear one early.
   */
  unlock(account: AdminAccount, remarks: string | null): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/${account.userUid}/unlock`, { remarks })
      .pipe(map((r) => r.message));
  }
}
