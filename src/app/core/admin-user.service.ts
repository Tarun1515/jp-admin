import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map, of, tap } from 'rxjs';

/** An administrator, as the queue's assignee filter needs them. */
export interface AdminUser {
  userUid: string;
  email: string;
}

/** The subset of a /api/users row this screen reads. */
interface UserListRow {
  userUid: string;
  email: string;
}

/** m_sso_user_status. Active. */
const STATUS_ACTIVE = 2;

/** m_sso_user_types. Admin. */
const USER_TYPE_ADMIN = 1;

/**
 * The administrators, for the queue's "assigned to" filter.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS — G15
 * ----------------------------------------------------------------------------
 * The queue could only ever filter by "me", because the screen had exactly one
 * identity it could name: the one in its own token. Asking "what is Anjali
 * working on" needs to know who the administrators ARE, and they live in
 * jp_sso behind an endpoint this app had never called.
 *
 * ⚠️ It returns Uids, not the numeric ids the queue's column holds. That is
 * deliberate: the Uid is the key that crosses a database boundary in this
 * system (2.2), and the API resolves it to an id on the way to jp_mdm. A
 * numeric jp_sso id in a query string would be the wrong key in the wrong place.
 *
 * ⚠️ Cached for the session. The set of administrators changes roughly never,
 * and re-fetching it would put a second request behind every filter change.
 */
@Injectable({ providedIn: 'root' })
export class AdminUserService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly cache = signal<AdminUser[] | null>(null);

  list(): Observable<AdminUser[]> {
    const cached = this.cache();

    if (cached !== null) {
      return of(cached);
    }

    const params = new HttpParams()
      .set('userTypeId', USER_TYPE_ADMIN)
      .set('statusId', STATUS_ACTIVE)
      .set('pageSize', 200);

    return this.http.get<ApiResponse<UserListRow[]>>(`${this.api.ssoApiUrl}/users`, { params }).pipe(
      map((response) =>
        (response.data ?? [])
          .map((row) => ({ userUid: row.userUid, email: row.email }))
          // Sorted here rather than by the server: the list procedure's sort
          // whitelist is its own, and a value it does not recognise falls back
          // silently to another order.
          .sort((a, b) => a.email.localeCompare(b.email)),
      ),
      tap((users) => this.cache.set(users)),
    );
  }
}
