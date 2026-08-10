import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

import {
  ApprovalDetail,
  ApprovalFilter,
  ApprovalListItem,
  OrphanedApproval,
  PendingCount,
  ProcessActionBody,
  ProcessActionResult,
} from './approval.models';

/** One page of the queue, plus the count before paging. */
export interface ApprovalPage {
  items: ApprovalListItem[];
  totalRecords: number;
}

/**
 * The approval engine, over HTTP.
 *
 * No caching anywhere in here, deliberately. Every other admin looking at this
 * queue is changing it, and a stale page is how two people action the same
 * request — the RowVersion check catches that, but a queue that shows work
 * somebody finished ten minutes ago wastes the time before the check fires.
 *
 * ⚠️ Nothing here sends an organisation, a user id or a scope. Those come from
 * the token on the server (decision 2.39); a parameter for them would be a
 * parameter somebody could change.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/approvals`;

  /**
   * One page of the queue.
   *
   * The server sorts oldest-first and there is no sort parameter, because this
   * is a work queue: the oldest request is the one that has been failing
   * somebody the longest, and it should not be possible to hide it behind a
   * column header.
   */
  list(filter: ApprovalFilter): Observable<ApprovalPage> {
    let params = new HttpParams();

    for (const [key, value] of Object.entries(filter)) {
      // An empty string is a filter nobody set. Sending it would make the
      // server search for the empty string, which matches everything and looks
      // like the filter is broken.
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http
      .get<ApiResponse<ApprovalListItem[]>>(this.baseUrl, { params })
      .pipe(
        map((response) => ({
          items: response.data ?? [],
          totalRecords: response.totalRecords ?? 0,
        })),
      );
  }

  getById(requestId: number): Observable<ApprovalDetail> {
    return this.http
      .get<ApiResponse<ApprovalDetail>>(`${this.baseUrl}/${requestId}`)
      .pipe(map((response) => response.data as ApprovalDetail));
  }

  /**
   * Approve, reject, or ask for a resubmission.
   *
   * 🔴 Read `orchestrationCompleted` on the result. See ProcessActionResult.
   */
  action(requestId: number, body: ProcessActionBody): Observable<ProcessActionResult> {
    return this.http
      .post<ApiResponse<ProcessActionResult>>(`${this.baseUrl}/${requestId}/action`, body)
      .pipe(map((response) => response.data as ProcessActionResult));
  }

  /**
   * Runs the cross-database work again for an approval that already completed.
   *
   * Idempotent end to end, so pressing it twice is not a mistake — it either
   * finishes the missing work or reports the same failure again.
   */
  retryOrchestration(requestId: number): Observable<ProcessActionResult> {
    return this.http
      .post<ApiResponse<ProcessActionResult>>(`${this.baseUrl}/${requestId}/retry-orchestration`, {})
      .pipe(map((response) => response.data as ProcessActionResult));
  }

  /** Approvals that completed but never provisioned. Empty is the healthy answer. */
  orphaned(): Observable<OrphanedApproval[]> {
    return this.http
      .get<ApiResponse<OrphanedApproval[]>>(`${this.baseUrl}/orphaned`)
      .pipe(map((response) => response.data ?? []));
  }

  counts(): Observable<PendingCount[]> {
    return this.http
      .get<ApiResponse<PendingCount[]>>(`${this.baseUrl}/counts`)
      .pipe(map((response) => response.data ?? []));
  }
}
