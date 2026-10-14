import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * 🔒 THE REPORTER'S IDENTITY LIVES IN EXACTLY ONE PLACE IN THE CLIENT: HERE.
 *
 * `ReportRow.reportedByUserUid` is returned by `GET /api/admin/desk/reports`
 * and by nothing else in the product. No school-facing or teacher-facing
 * endpoint returns it, 025 guards the column's projection in SQL, and 7B's
 * verification reads the raw bytes of every response the reported party can
 * fetch to prove it is absent.
 *
 * ⚠️ So nothing here may be handed to a component a school or a teacher can
 * reach. This service existing only in jp-admin is the structural half of that
 * guarantee; the server's permission check is the half that actually holds.
 */

/** One row of the moderation queue — `GET /api/admin/desk/jobs`. */
export interface ModeratableJob {
  jobUid: string;
  jobTitle: string;
  schoolUid: string;
  schoolName: string;
  cityName: string | null;

  /**
   * 🔴 EFFECTIVE status (2.65), not the stored one: a job whose last date has
   * passed reads 3/Expired here, which is what the public site shows, even
   * though no row anywhere stores 3.
   */
  effectiveStatusId: number;
  statusName: string | null;

  /**
   * How many people applied — DERIVED in SQL, counted fresh on every read.
   *
   * ⚠️ Not t_app_jobs.ApplicationCount, which the product forbids writing
   * (016) and reading (017). The first version of the queue read it and showed
   * 0 for every advert; the screens suite caught it with two applications on
   * the row. A moderator about to take an advert down is the last person who
   * should be shown a stale zero.
   */
  applicationCount: number;
  viewCount: number;
  publishedOn: string | null;
  lastDateToApply: string | null;

  /** Open (non-terminal) complaints. The triage signal. */
  openReportCount: number;

  /** PULL or RESTORE, or null for a job moderation has never touched. */
  lastActionType: string | null;
  lastActionOn: string | null;
}

/** One line of a job's moderation history. Append-only, newest first. */
export interface ModerationEntry {
  logId: number;
  actionType: string;
  remarks: string;
  actionOn: string;
  previousStatusName: string | null;
}

/** One row of the reports queue. */
export interface ReportRow {
  reportUid: string;
  reportedEntityType: string;
  entityUid: string | null;
  entityName: string | null;
  reasonName: string;
  description: string | null;
  statusCode: string;
  statusName: string;

  /** 🔒 Admin-only. See the file header. */
  reportedByUserUid: string;

  /** How many reports this account has filed — a pattern, or a one-off. */
  reportsByThisAccount: number;
  adminRemarks: string | null;
  reviewedOn: string | null;
  createdOn: string;
}

/** A page of rows, plus the count before paging. */
export interface ModerationPage<T> {
  rows: T[];
  totalRecords: number;
}

/**
 * Moderation: the advert queue, pull and restore, and the reports queue.
 *
 * ----------------------------------------------------------------------------
 * 🔒 TWO PERMISSIONS, AND THIS SERVICE CHECKS NEITHER
 * ----------------------------------------------------------------------------
 * MODERATION.JOB gates the job half and MODERATION.REPORT the report half,
 * enforced in AdminDeskService on every call. The menu rows carry the same two
 * codes, so nobody without them is offered the links — and if they type the
 * URL, every call this service makes is refused 403.
 *
 * Re-checking here would be a second answer to a question the server already
 * answers, and the two would drift. 7B's verification forces the negative with
 * a VERIFICATION_ADMIN, who holds neither.
 *
 * ----------------------------------------------------------------------------
 * 🔴 NO CACHING, AND FOR A SHARPER REASON THAN THE APPROVAL QUEUE'S
 * ----------------------------------------------------------------------------
 * A pulled job leaves the public site the same second — every public response
 * is `no-store` (7A-0), so there is no edge or browser copy to wait out. A
 * client cache here would be the one place left in the chain still showing an
 * advert as live after a colleague pulled it.
 */
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private get base(): string {
    return `${this.api.appApiUrl}/admin/desk`;
  }

  // ---- the advert queue ----------------------------------------------------

  private readonly jobsSignal = signal<ModeratableJob[]>([]);
  private readonly jobsTotalSignal = signal(0);
  private readonly jobsLoadingSignal = signal(false);

  /**
   * 🔴 A FAILED READ IS NOT AN EMPTY QUEUE. "Nothing has been reported" and
   * "we could not ask" are different statements, and showing the first when
   * the second is true is how a fake advert stays up for a week.
   */
  private readonly jobsFailedSignal = signal(false);

  readonly jobs = this.jobsSignal.asReadonly();
  readonly jobsTotal = this.jobsTotalSignal.asReadonly();
  readonly jobsLoading = this.jobsLoadingSignal.asReadonly();
  readonly jobsFailed = this.jobsFailedSignal.asReadonly();

  loadJobs(filter: {
    statusId?: number | null;
    search?: string | null;
    reportedOnly?: boolean;
    pageNumber?: number;
    pageSize?: number;
  } = {}): void {
    this.jobsLoadingSignal.set(true);
    this.jobsFailedSignal.set(false);

    let params = new HttpParams()
      .set('pageNumber', String(filter.pageNumber ?? 1))
      .set('pageSize', String(filter.pageSize ?? 20));

    if (filter.statusId) params = params.set('statusId', String(filter.statusId));
    if (filter.search) params = params.set('search', filter.search);
    if (filter.reportedOnly) params = params.set('reportedOnly', 'true');

    this.http
      .get<ApiResponse<ModeratableJob[]>>(`${this.base}/jobs`, { params })
      .subscribe({
        next: (response) => {
          this.jobsSignal.set(response.data ?? []);
          this.jobsTotalSignal.set(response.totalRecords ?? 0);
          this.jobsLoadingSignal.set(false);
        },
        error: () => {
          this.jobsFailedSignal.set(true);
          this.jobsLoadingSignal.set(false);
        },
      });
  }

  /**
   * Pull an advert.
   *
   * 🔴 The remarks are REQUIRED and the server refuses without them, because
   * they are what the school is shown (2.62 — not allowed, stated). "Pulled"
   * with no reason leaves a school with nothing to fix.
   */
  pull(jobUid: string, remarks: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/jobs/${jobUid}/pull`, { remarks })
      .pipe(map((r) => r.message));
  }

  /**
   * Put it back — to the status it held BEFORE the pull, which the server
   * reads out of the log rather than guessing. A pulled draft returns to
   * draft, not to live.
   */
  restore(jobUid: string, remarks: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/jobs/${jobUid}/restore`, { remarks })
      .pipe(map((r) => r.message));
  }

  history(jobUid: string): Observable<ModerationEntry[]> {
    return this.http
      .get<ApiResponse<ModerationEntry[]>>(`${this.base}/jobs/${jobUid}/history`)
      .pipe(map((r) => r.data ?? []));
  }

  // ---- the reports queue ---------------------------------------------------

  searchReports(filter: {
    statusId?: number | null;
    entityType?: string | null;
    pageNumber?: number;
    pageSize?: number;
  } = {}): Observable<ModerationPage<ReportRow>> {
    let params = new HttpParams()
      .set('pageNumber', String(filter.pageNumber ?? 1))
      .set('pageSize', String(filter.pageSize ?? 20));

    if (filter.statusId) params = params.set('statusId', String(filter.statusId));
    if (filter.entityType) params = params.set('entityType', filter.entityType);

    return this.http
      .get<ApiResponse<ReportRow[]>>(`${this.base}/reports`, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], totalRecords: r.totalRecords ?? 0 })));
  }

  updateReportStatus(
    reportUid: string,
    statusId: number,
    adminRemarks: string | null,
  ): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(
        `${this.base}/reports/${reportUid}/status`,
        { statusId, adminRemarks },
      )
      .pipe(map((r) => r.message));
  }
}
