import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * The site's own copy, and what gets promoted on it. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔒 CMS.MANAGE GATES ALL THREE, AND FEATURED PLACEMENT IS ONE OF THEM
 * ----------------------------------------------------------------------------
 * Featured windows, FAQs and content blocks share one permission because they
 * are one job: deciding what a visitor who is not signed in sees. A separate
 * FEATURED.MANAGE would have been a second holder set to keep in step with the
 * first for no difference in who holds it.
 *
 * ⚠️ That decision is recorded rather than assumed — if featured placement
 * ever becomes a commercial product (sold slots, an invoice behind each one)
 * it stops being editorial and earns its own permission.
 *
 * ----------------------------------------------------------------------------
 * 🔴 FEATURED IS A DATE RANGE, NOT A FLAG
 * ----------------------------------------------------------------------------
 * There is no IsFeatured column anywhere and no job that runs at midnight.
 * A window is live when today-in-IST falls inside it, computed on every read
 * (`fn_IstToday`), which is why a window that ended yesterday needed nothing
 * to end it. `isLiveToday` below is the server's answer, never recomputed
 * here: a client that re-derived it would disagree with the public site for
 * five and a half hours a day.
 */

/** One featured window. */
export interface FeaturedWindow {
  featuredId: number;

  /** JOB or SCHOOL. */
  featuredType: string;
  entityUid: string;
  entityName: string;
  ownerName: string | null;

  /** Dates, IST, inclusive at both ends. */
  fromDate: string;
  toDate: string;
  displayOrder: number;

  /** 🔴 The server's answer, computed from today-in-IST. Never re-derived. */
  isLiveToday: boolean;

  /**
   * ⚠️ The entity's own status, so a window promoting a job that has since
   * been closed or pulled can be SEEN. Featuring is a separate decision from
   * publishing, and the public listing quietly drops the job — leaving an
   * admin to wonder why their window does nothing.
   */
  entityStatusName: string | null;
}

export interface SaveFeaturedBody {
  featuredType: string;
  entityUid: string;
  fromDate: string;
  toDate: string;
  displayOrder: number;
}

/** One FAQ, as the admin sees it — including the inactive ones. */
export interface AdminFaq {
  faqId: number;
  category: string;
  question: string;
  answer: string;
  displayOrder: number;
  isActive: boolean;
  modifiedOn: string | null;
}

export interface SaveFaqBody {
  faqId: number | null;
  category: string;
  question: string;
  answer: string;
  displayOrder: number;
  isActive: boolean;
}

/** One block of designated copy, addressed by key. */
export interface AdminContentBlock {
  blockId: number;

  /**
   * 🔴 THE KEY IS THE CONTRACT. A page asks for a block by key; renaming one
   * is not an edit, it is unpublishing the old block and creating a new one
   * that nothing asks for.
   */
  blockKey: string;
  blockTitle: string | null;
  blockContent: string;
  imagePath: string | null;
  displayOrder: number;
  isActive: boolean;
  modifiedOn: string | null;
}

export interface SaveContentBlockBody {
  blockKey: string;
  blockTitle: string | null;
  blockContent: string;
  imagePath: string | null;
  displayOrder: number;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private get base(): string {
    return `${this.api.appApiUrl}/admin/desk`;
  }

  // ---- featured ------------------------------------------------------------

  listFeatured(): Observable<FeaturedWindow[]> {
    return this.http
      .get<ApiResponse<FeaturedWindow[]>>(`${this.base}/featured`)
      .pipe(map((r) => r.data ?? []));
  }

  /**
   * Create or extend a window.
   *
   * ⚠️ Dates are sent as plain `yyyy-MM-dd`, which is what `<input type=date>`
   * gives and what the column is. Sending an instant would put the boundary at
   * 05:30 IST for anybody who wrote it as UTC midnight (2.28) — the same trap
   * t_app_jobs.LastDateToApply records.
   */
  saveFeatured(body: SaveFeaturedBody): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/featured`, body)
      .pipe(map((r) => r.message));
  }

  /**
   * Remove a placement. A soft delete of the window, not a state change on the
   * thing featured: the job carries on exactly as it was.
   */
  removeFeatured(featuredType: string, featuredId: number): Observable<string> {
    return this.http
      .delete<ApiResponse<null>>(`${this.base}/featured/${featuredType}/${featuredId}`)
      .pipe(map((r) => r.message));
  }

  // ---- FAQs ----------------------------------------------------------------

  listFaqs(): Observable<AdminFaq[]> {
    return this.http
      .get<ApiResponse<AdminFaq[]>>(`${this.base}/faqs`)
      .pipe(map((r) => r.data ?? []));
  }

  saveFaq(body: SaveFaqBody): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/faqs`, body)
      .pipe(map((r) => r.message));
  }

  deleteFaq(faqId: number): Observable<string> {
    return this.http
      .delete<ApiResponse<null>>(`${this.base}/faqs/${faqId}`)
      .pipe(map((r) => r.message));
  }

  // ---- content blocks ------------------------------------------------------

  listContentBlocks(): Observable<AdminContentBlock[]> {
    return this.http
      .get<ApiResponse<AdminContentBlock[]>>(`${this.base}/content-blocks`)
      .pipe(map((r) => r.data ?? []));
  }

  /** Upsert by key — there is no separate create and update. */
  saveContentBlock(body: SaveContentBlockBody): Observable<string> {
    return this.http
      .post<ApiResponse<null>>(`${this.base}/content-blocks`, body)
      .pipe(map((r) => r.message));
  }
}
