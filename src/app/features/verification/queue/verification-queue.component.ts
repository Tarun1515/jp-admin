import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, MasterService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';

import { ApprovalListItem, APPROVAL_STATUS, REQUEST_TYPE } from '../../../core/approval.models';
import { ApprovalService } from '../../../core/approval.service';

const PAGE_SIZE = 20;

/** A request nobody has touched for this long is the one that has failed someone. */
const ATTENTION_DAYS = 3;

type SortDirection = 'ASC' | 'DESC';

/**
 * The verification queue.
 *
 * ----------------------------------------------------------------------------
 * A WORK QUEUE, NOT A REPORT
 * ----------------------------------------------------------------------------
 * The person here is clearing a backlog. Everything follows from that:
 *
 *   OLDEST FIRST by default, decided in SQL rather than here, because the
 *   oldest request is the one that has been failing somebody the longest.
 *
 *   THE MARGIN RULE lets the eye triage before it reads — red on anything
 *   waiting more than three days. The row also SAYS how long it has waited, so
 *   the colour is reinforcement and never the only carrier. This is the same
 *   grammar as the applicants table in jp-school, deliberately: one product,
 *   one visual language for "needs action".
 *
 *   WAITING DAYS COME FROM THE SERVER (`waitingDays`), not from subtracting
 *   dates in the browser. A machine with a wrong clock would otherwise disagree
 *   with the dashboard about which request is oldest.
 *
 * ----------------------------------------------------------------------------
 * WHY THE TABLE IS HAND-WRITTEN RATHER THAN `<ui-table>`
 * ----------------------------------------------------------------------------
 * ui-table renders one cell per column through a value function. This queue
 * needs the margin rule on the ROW, driven by a value in that row — which is a
 * class binding on `<tr>`, not something a column definition can express.
 *
 * Sorting and paging are still server-driven and still emit exactly what
 * ui-table would: a sortBy/sortDirection pair the procedure resolves through a
 * CASE whitelist, and a page number. Nothing is sorted or sliced here.
 */
@Component({
  selector: 'app-verification-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './verification-queue.component.html',
  styleUrl: './verification-queue.component.scss',
})
export class VerificationQueueComponent {
  private readonly approvals = inject(ApprovalService);
  private readonly masters = inject(MasterService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /**
   * Which tab this route is. Bound from route data by
   * `withComponentInputBinding`, so /verification/schools and
   * /verification/teachers are one component and the tabs are real links —
   * back, refresh and bookmark all work.
   */
  readonly tab = input<'schools' | 'teachers'>('schools');

  protected readonly requestTypeId = computed(() =>
    this.tab() === 'teachers' ? REQUEST_TYPE.teacherVerification : REQUEST_TYPE.schoolRegistration,
  );

  // ---- filters ------------------------------------------------------------
  protected readonly search = signal('');
  protected readonly statusId = signal<number | ''>(APPROVAL_STATUS.pending);
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly mineOnly = signal(false);

  protected readonly page = signal(1);
  protected readonly sortBy = signal<string | undefined>(undefined);
  protected readonly sortDirection = signal<SortDirection>('ASC');

  /**
   * Bumped to force a reload without changing what is being asked for.
   *
   * Refresh is not a filter, but it has to go through the same effect —
   * otherwise there are two places that build the query and two chances for
   * them to disagree about what the screen is showing.
   */
  private readonly reloadToken = signal(0);

  // ---- data ---------------------------------------------------------------
  protected readonly rows = signal<ApprovalListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly statuses = signal<Lookup[]>([]);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  protected readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1,
  );

  protected readonly rangeEnd = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));

  protected readonly hasFilters = computed(
    () =>
      !!this.search() ||
      this.statusId() !== APPROVAL_STATUS.pending ||
      !!this.fromDate() ||
      !!this.toDate() ||
      this.mineOnly(),
  );

  /** How many rows on this page have been waiting too long. Drives the toolbar count. */
  protected readonly attentionCount = computed(
    () => this.rows().filter((row) => this.needsAttention(row)).length,
  );

  constructor() {
    this.masters.get(MASTER_KEYS.approvalStatus).subscribe({
      next: (items) => this.statuses.set(items),
      // A missing status list is a smaller problem than a broken screen: the
      // queue still works, the filter just has fewer options.
      error: () => this.statuses.set([]),
    });

    /*
      One effect, reading every signal the query depends on. Switching tab,
      changing a filter or turning a page all land here, so there is exactly
      one place a request is issued from and no combination that forgets to.
    */
    effect(() => {
      this.reloadToken();

      const filter = {
        requestTypeId: this.requestTypeId(),
        statusId: this.statusId() === '' ? undefined : Number(this.statusId()),
        assignedToUserId: this.mineOnly() ? this.currentUserId() : undefined,
        fromDate: this.fromDate() || undefined,
        toDate: this.toDate() || undefined,
        search: this.search().trim() || undefined,
        sortBy: this.sortBy(),
        sortDirection: this.sortBy() ? this.sortDirection() : undefined,
        pageNumber: this.page(),
        pageSize: PAGE_SIZE,
      };

      this.loading.set(true);

      this.approvals.list(filter).subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.totalRecords);
          this.loading.set(false);
        },
        error: () => {
          // The interceptor has already told the user what went wrong. Clearing
          // the rows matters more: leaving the previous page on screen under a
          // failed refresh is how somebody actions a request that has moved on.
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
    });
  }

  private currentUserId(): number | undefined {
    return this.auth.currentUser()?.userId;
  }

  /**
   * Waiting too long, and still open.
   *
   * A completed request is not urgent however old it is — it is done, and
   * flagging it red would train people to ignore the colour.
   */
  protected needsAttention(row: ApprovalListItem): boolean {
    return this.isOpen(row) && row.waitingDays >= ATTENTION_DAYS;
  }

  protected isOpen(row: ApprovalListItem): boolean {
    return (
      row.statusId === APPROVAL_STATUS.pending || row.statusId === APPROVAL_STATUS.resubmitRequired
    );
  }

  /*
    ONE HIERARCHY, HELD — the same rule as the applicants table.

      the margin   ATTENTION, and nothing else. Red when this row has been
                   waiting on us. One colour, one meaning.
      the mute     a finished request recedes as a whole rather than being
                   struck through or greyed cell by cell.
      the words    the waiting column says the same thing in text, because 3px
                   of colour cannot be the only carrier of the triage.
  */
  protected rowState(row: ApprovalListItem): string {
    if (!this.isOpen(row)) return 'row--muted';
    if (this.needsAttention(row)) return 'row--attention';

    return '';
  }

  protected waitingLabel(row: ApprovalListItem): string {
    if (!this.isOpen(row)) {
      return row.statusId === APPROVAL_STATUS.approved ? 'Approved' : row.statusName;
    }

    if (row.waitingDays === 0) return 'Today';
    if (row.waitingDays === 1) return '1 day';

    return `${row.waitingDays} days`;
  }

  protected statusTone(row: ApprovalListItem): 'neutral' | 'success' | 'warning' | 'danger' {
    switch (row.statusId) {
      case APPROVAL_STATUS.approved:
        return 'success';
      case APPROVAL_STATUS.rejected:
        return 'danger';
      case APPROVAL_STATUS.resubmitRequired:
        return 'warning';
      default:
        return 'neutral';
    }
  }

  // ---- interaction --------------------------------------------------------
  protected onFilterChange(): void {
    // Any filter change returns to page 1. Staying on page 4 of a result set
    // that now has two shows an empty table and reads as a bug.
    this.page.set(1);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.statusId.set(APPROVAL_STATUS.pending);
    this.fromDate.set('');
    this.toDate.set('');
    this.mineOnly.set(false);
    this.page.set(1);
  }

  protected onSort(key: string): void {
    if (this.sortBy() === key) {
      this.sortDirection.update((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      this.sortBy.set(key);
      this.sortDirection.set(key === 'waitingDays' ? 'DESC' : 'ASC');
    }

    this.page.set(1);
  }

  protected ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    if (this.sortBy() !== key) return 'none';

    return this.sortDirection() === 'ASC' ? 'ascending' : 'descending';
  }

  protected goToPage(page: number): void {
    this.page.set(Math.max(1, Math.min(page, this.totalPages())));
  }

  protected readonly pageNumbers = computed(() => {
    const total = this.totalPages();

    // A window, not every page. Fine at 8 pages, unusable at 400 — and a
    // verification backlog reaches 400 in a bad month.
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const current = this.page();
    const pages: number[] = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    if (start > 2) pages.push(-1);
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < total - 1) pages.push(-1);
    pages.push(total);

    return pages;
  });

  protected open(row: ApprovalListItem): void {
    void this.router.navigate(['/verification/requests', row.requestId]);
  }

  /** Keyboard equivalent of clicking the row. */
  protected onRowKey(event: KeyboardEvent, row: ApprovalListItem): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open(row);
    }
  }

  protected refresh(): void {
    this.reloadToken.update((n) => n + 1);
  }

  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);
}
