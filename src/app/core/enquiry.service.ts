import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * One message from the public contact form.
 *
 * 🔒 THERE IS NO CALLER IDENTITY HERE, AND THERE IS NO COLUMN FOR ONE.
 * An enquiry arrives from an anonymous visitor: 033 gave the table no user id,
 * no token is read on the public route even if one is sent (7A), and the name
 * and email below are what the person typed. They are contact details the
 * visitor volunteered in order to be replied to — which is why this is the one
 * admin surface that legitimately shows an email address.
 *
 * ⚠️ 2.56 is untouched by that. The prohibition is on a TEACHER'S contact
 * reaching a school without the teacher's consent; a visitor asking to be
 * contacted is the consent, and no teacher row is involved.
 */
export interface Enquiry {
  enquiryId: number;
  name: string;
  email: string;
  mobile: string | null;
  subject: string;
  message: string;
  isResolved: boolean;
  resolvedOn: string | null;
  resolutionRemarks: string | null;
  createdOn: string;
}

export interface EnquiryPage {
  rows: Enquiry[];
  totalRecords: number;
}

/**
 * The contact queue. 🔒 ENQUIRY.MANAGE.
 *
 * ----------------------------------------------------------------------------
 * WHY ITS OWN PERMISSION
 * ----------------------------------------------------------------------------
 * Answering the public inbox is not moderation and not content editing. The
 * people who do it are a support function, and the alternative — reusing
 * MODERATION.REPORT — would have meant anyone who can read complaints can
 * read every visitor's email address, which is a wider grant than the job
 * needs.
 *
 * ⚠️ FLAGGED FOR THE CLIENT rather than decided silently: if support and
 * moderation turn out to be the same two people, the permission can be granted
 * to MODERATION_ADMIN in a one-line seed change. The structure allows that;
 * the reverse — splitting a permission after the fact — does not.
 */
@Injectable({ providedIn: 'root' })
export class EnquiryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private get base(): string {
    return `${this.api.appApiUrl}/admin/desk/enquiries`;
  }

  search(filter: {
    isResolved?: boolean | null;
    pageNumber?: number;
    pageSize?: number;
  } = {}): Observable<EnquiryPage> {
    let params = new HttpParams()
      .set('pageNumber', String(filter.pageNumber ?? 1))
      .set('pageSize', String(filter.pageSize ?? 20));

    /*
      ⚠️ `=== null` rather than a falsy check: `false` is a REAL filter here
      ("show me the unanswered ones") and a truthiness test would drop it,
      silently returning everything. The same shape of bug as a `0` page
      number being treated as absent.
    */
    if (filter.isResolved !== null && filter.isResolved !== undefined) {
      params = params.set('isResolved', String(filter.isResolved));
    }

    return this.http
      .get<ApiResponse<Enquiry[]>>(this.base, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], totalRecords: r.totalRecords ?? 0 })));
  }

  /**
   * Mark one answered, with what was said.
   *
   * 🔴 The remarks are required, and 033's CHECK constraint is what enforces
   * the trail: resolved, by whom, when, and what they were told all arrive
   * together or not at all. "Resolved" on its own tells the next person
   * nothing — and the next person is often the same person in a month.
   */
  resolve(enquiryId: number, remarks: string): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/${enquiryId}/resolve`, { remarks })
      .pipe(map((r) => r.message));
  }
}
