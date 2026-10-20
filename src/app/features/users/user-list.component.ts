import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from 'jp-shared/core';
import { UiBadgeComponent, UiBadgeTone } from 'jp-shared/ui';

import { AccountStatusChange, AdminAccount, UserAdminService } from '../../core/user-admin.service';

/** What the open panel is about to do. */
type Intent = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'unlock';

/**
 * Accounts — search across every user type, and change one's status. Phase 8-0.
 *
 * ----------------------------------------------------------------------------
 * THE BACKEND WAS ALREADY THERE
 * ----------------------------------------------------------------------------
 * §3 lists user management in the MVP and the route has pointed at the
 * coming-soon page since 1D. 8-0 checked what was missing before building:
 * `GET /api/users` already took a search term, a type, a status, a date range,
 * a sort and paging, and `PUT /api/users/{uid}/status` already enforced
 * RowVersion. So this phase owed a screen, not an endpoint.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE REASON FIELD IS NOW ON EVERY TRANSITION — G45 CLOSED IN 8A
 * ----------------------------------------------------------------------------
 * 8-0 shipped this screen with the field on suspend and unlock only, and said
 * in writing why: those were the two transitions whose reason the product
 * actually kept. An approve, a reject or a reactivate accepted the same
 * parameter and threw it away, and collecting a note that goes nowhere is the
 * contact form's `role` field, which 7A deleted rather than store nowhere.
 *
 * 8A built the table that was missing. `t_sso_user_status_history` is
 * append-only and records every transition with its reason, the administrator
 * and the instant — so the field is offered everywhere now, and the panel
 * shows what was recorded before.
 *
 * It stays REQUIRED for a suspension and optional elsewhere. Requiring it
 * everywhere would make an approval a form to fill in, and approvals are the
 * action an administrator does fifty times in a sitting.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ LOCKED IS NOT A STATUS AN ADMINISTRATOR SETS
 * ----------------------------------------------------------------------------
 * Status 5 exists, and `USP_UpdateUserStatus` refuses to be given it: "use
 * suspend rather than lock for an administrative action". A lockout comes from
 * failed sign-ins and expires by itself. So this screen offers Suspend, never
 * Lock, and Unlock is a separate action against a separate endpoint.
 *
 * 🔒 USER.MANAGE — checked by the server on every call; the menu row carries
 * the same code. This screen does not re-check it.
 */
@Component({
  selector: 'app-user-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiBadgeComponent],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
})
export class UserListComponent {
  private readonly users = inject(UserAdminService);

  /**
   * 🔴 WHO IS LOOKING — because nothing stops them suspending themselves.
   *
   * Phase 8-0 went looking and found NO self-action guard and NO last-admin
   * guard: not in USP_UpdateUserStatus, not in UserService. An administrator
   * can suspend their own account, and if they are the only SUPER_ADMIN the
   * platform is left with nobody who can administer it — recoverable only
   * through JP.Tools.SeedAdmin or direct SQL.
   *
   * ⚠️ THIS IS NOT THE FIX, AND MUST NOT BE MISTAKEN FOR ONE. Hiding a button
   * is presentation; protection is the API's job, which is this project's
   * locked position (2.9, and every screen that re-checks nothing). The
   * server-side gate is G46, for 8A's security pass. What this does is stop
   * the product offering somebody a foot-gun while the gate is written.
   */
  private readonly auth = inject(AuthService);

  protected readonly myUid = computed(() => this.auth.currentUser()?.userUid ?? null);

  protected readonly rows = this.users.rows;
  protected readonly total = this.users.total;
  protected readonly loading = this.users.isLoading;
  protected readonly failed = this.users.hasFailed;

  // ---- the filter strip ----------------------------------------------------

  protected readonly search = signal('');
  protected readonly userTypeId = signal<number | null>(null);
  protected readonly statusId = signal<number | null>(null);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;

  /** m_sso_user_types. */
  protected readonly types = [
    { id: 1, label: 'Administrators' },
    { id: 2, label: 'Schools' },
    { id: 3, label: 'Teachers' },
  ];

  /**
   * m_sso_user_status.
   *
   * ⚠️ LOCKED (5) is in this list for FILTERING and not for setting — finding
   * the locked-out accounts is exactly what somebody needs when a school rings
   * up, and it is the one status this screen can show but never assign.
   */
  protected readonly statuses = [
    { id: 1, label: 'Pending approval' },
    { id: 2, label: 'Active' },
    { id: 3, label: 'Rejected' },
    { id: 4, label: 'Suspended' },
    { id: 5, label: 'Locked' },
    { id: 6, label: 'Resubmit required' },
  ];

  protected readonly filtered = computed(
    () => this.search().trim().length > 0 || this.userTypeId() !== null || this.statusId() !== null,
  );

  protected readonly totalPages = computed(
    () => Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  protected readonly rangeStart = computed(
    () => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize + 1),
  );

  protected readonly rangeEnd = computed(
    () => Math.min(this.page() * this.pageSize, this.total()),
  );

  // ---- the panel -----------------------------------------------------------

  protected readonly open = signal<AdminAccount | null>(null);
  protected readonly intent = signal<Intent>('suspend');
  protected readonly remarks = signal('');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<string | null>(null);

  /** 🔴 The two actions whose note is actually stored. */
  /**
   * The account's recorded history, loaded when a panel opens.
   *
   * ⚠️ THREE STATES, NOT TWO: not loaded yet, loaded and empty, loaded with
   * rows. "No history" and "still loading" look identical if they share one
   * signal, and the difference matters here — an administrator deciding whether
   * to reject a school a second time needs to know the absence is real.
   */
  protected readonly history = signal<AccountStatusChange[] | null>(null);

  protected readonly historyFailed = signal(false);

  protected readonly reasonMissing = computed(
    () => this.intent() === 'suspend' && this.remarks().trim().length === 0,
  );

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.users.load({
      search: this.search().trim() || null,
      userTypeId: this.userTypeId(),
      statusId: this.statusId(),
      pageNumber: this.page(),
      pageSize: this.pageSize,
    });
  }

  protected onFilterChange(): void {
    this.page.set(1);
    this.reload();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.userTypeId.set(null);
    this.statusId.set(null);
    this.onFilterChange();
  }

  protected goToPage(next: number): void {
    if (next < 1 || next > this.totalPages() || next === this.page()) return;

    this.page.set(next);
    this.reload();
  }

  protected pageNumbers(): number[] {
    return Array.from({ length: this.totalPages() }, (_, index) => index + 1);
  }

  // ---- acting --------------------------------------------------------------

  /**
   * 🔴 G45: THE REASON IS KEPT ON EVERY TRANSITION NOW, so this is gone.
   *
   * It used to be `intent === 'suspend' || intent === 'unlock'`, hiding the
   * field on the three transitions whose reason the product discarded. The
   * history table removed the reason to hide it.
   */
  protected start(row: AdminAccount, intent: Intent): void {
    this.open.set(row);
    this.intent.set(intent);
    this.remarks.set('');

    /*
      G45 — what was recorded before, loaded as the panel opens. A failure is
      shown as a failure rather than as an empty history: "nobody has ever
      changed this account" and "we could not find out" are different answers.
    */
    this.history.set(null);
    this.historyFailed.set(false);

    this.users.statusHistory(row).subscribe({
      next: (rows) => this.history.set(rows),
      error: () => {
        this.history.set([]);
        this.historyFailed.set(true);
      },
    });
    this.outcome.set(null);
  }

  protected cancel(): void {
    this.open.set(null);
  }

  protected confirm(): void {
    const account = this.open();
    if (!account || this.submitting() || this.reasonMissing()) return;

    this.submitting.set(true);

    const note = this.remarks().trim() || null;

    const call = this.intent() === 'unlock'
      ? this.users.unlock(account, note)
      : this.users.updateStatus(account, this.targetStatus(), note);

    call.subscribe({
      next: (message) => {
        this.submitting.set(false);
        this.outcome.set(message);
        this.open.set(null);

        /*
          🔴 Reloaded rather than patched. The status changes AND the
          RowVersion moves, and a row holding a stale RowVersion would refuse
          the next action with CONCURRENCY_CONFLICT — a confusing way to
          discover the screen edited itself out of date.
        */
        this.reload();
      },
      error: () => {
        this.submitting.set(false);

        /*
          ⚠️ No message of our own. The interceptor shows the server's, which
          distinguishes a stale RowVersion from "already in that state" — two
          refusals this screen must not blur into "something went wrong".
        */
      },
    });
  }

  private targetStatus(): number {
    switch (this.intent()) {
      case 'approve': return 2;
      case 'reject': return 3;
      case 'suspend': return 4;
      default: return 2;   // reactivate
    }
  }

  // ---- presentation --------------------------------------------------------

  protected tone(row: AdminAccount): UiBadgeTone {
    switch (row.statusId) {
      case 2: return 'success';
      case 1: return 'warning';
      case 6: return 'warning';
      case 3: return 'danger';
      case 4: return 'danger';
      default: return 'neutral';   // 5 LOCKED
    }
  }

  protected canApprove(row: AdminAccount): boolean {
    return row.statusId === 1 || row.statusId === 6;
  }

  protected canReject(row: AdminAccount): boolean {
    return row.statusId === 1 || row.statusId === 6;
  }

  /**
   * ⚠️ NOT ON YOUR OWN ROW — see myUid. The action is ABSENT rather than
   * disabled, the 3F/3G rule: a disabled button invites a question the screen
   * cannot answer.
   */
  protected canSuspend(row: AdminAccount): boolean {
    return row.statusId === 2 && row.userUid !== this.myUid();
  }

  /** True on the signed-in administrator's own row. */
  protected isMe(row: AdminAccount): boolean {
    return row.userUid === this.myUid();
  }

  protected canReactivate(row: AdminAccount): boolean {
    return row.statusId === 3 || row.statusId === 4;
  }

  /**
   * ⚠️ Offered on a LOCKED account only. A lockout expires by itself, so this
   * is "do not make them wait", not "repair something broken".
   */
  protected canUnlock(row: AdminAccount): boolean {
    return row.statusId === 5;
  }

  protected intentLabel(): string {
    switch (this.intent()) {
      case 'approve': return 'Approve';
      case 'reject': return 'Reject';
      case 'suspend': return 'Suspend';
      case 'unlock': return 'Unlock';
      default: return 'Reactivate';
    }
  }

  /**
   * The day, in IST.
   *
   * ⚠️ Storage is UTC and the rules are IST (2.28). The zone is named so an
   * administrator abroad reads the same date as one in Mumbai.
   */
  protected day(value: string | null): string {
    if (!value) return 'never';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  }

  /**
   * A recorded moment — the date AND the time, which `day()` deliberately
   * omits for the table.
   *
   * 🔴 THE TRAILING Z IS LOAD BEARING, AND ITS ABSENCE IS MEASURABLE. The API
   * serialises these instants without a zone suffix — the live response reads
   * "2026-10-20T12:38:40.49" — and `new Date()` on a string with no zone
   * applies the BROWSER'S. In IST that renders a UTC instant five and a half
   * hours early, and it renders it confidently: a suspension at 18:08 would
   * appear as 12:38, with nothing on screen to suggest anything is wrong.
   *
   * `day()` beside this has handled it since 8-0 for the same reason. The zone
   * is then named explicitly so an administrator abroad reads the same clock as
   * one in Mumbai (2.28: storage UTC, rules IST).
   */
  protected when(value: string): string {
    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  }

  /** 🔒 Shortened for the eye. The uid is the key that crosses databases (2.2). */
  protected tag(row: AdminAccount): string {
    return row.userUid.split('-')[0];
  }
}
