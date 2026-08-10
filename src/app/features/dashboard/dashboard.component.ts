import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { APPROVAL_STATUS, ApprovalListItem, PendingCount, REQUEST_TYPE } from 'jp-shared/models';
import { ApprovalService } from '../../core/approval.service';
import { OrphanedApprovalsComponent } from './orphaned-approvals.component';

/**
 * What needs doing, and what has been done.
 *
 * ----------------------------------------------------------------------------
 * ONE SOURCE FOR EVERY NUMBER
 * ----------------------------------------------------------------------------
 * The pending counts and the waiting days both come from the server. Nothing
 * here recomputes a count from a page of rows, because a dashboard that says
 * eight while the queue shows twelve is a dashboard nobody trusts again.
 *
 * "Recent activity" is genuinely recent: the newest COMPLETED requests, not a
 * synthetic feed. If nothing has been completed, it says so.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, OrphanedApprovalsComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly approvals = inject(ApprovalService);

  protected readonly counts = signal<PendingCount[]>([]);
  protected readonly recent = signal<ApprovalListItem[]>([]);
  protected readonly loading = signal(true);

  protected readonly schoolCount = computed(() =>
    this.counts().find((c) => c.requestTypeId === REQUEST_TYPE.schoolRegistration),
  );

  protected readonly teacherCount = computed(() =>
    this.counts().find((c) => c.requestTypeId === REQUEST_TYPE.teacherVerification),
  );

  protected readonly totalPending = computed(() =>
    this.counts().reduce((sum, c) => sum + c.pendingCount, 0),
  );

  /**
   * The longest anything has been waiting, across every type.
   *
   * This is the number an admin is answerable for. A backlog of forty that is
   * all from this morning is a busy day; one request from three weeks ago is a
   * person who has given up on us.
   */
  protected readonly oldestWaiting = computed(() =>
    this.counts().reduce((worst, c) => Math.max(worst, c.oldestWaitingDays), 0),
  );

  constructor() {
    this.approvals.counts().subscribe({
      next: (counts) => {
        this.counts.set(counts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    // Newest completions first — the opposite of the queue, and right here:
    // this panel answers "what just happened", not "what is next".
    this.approvals
      .list({
        statusId: APPROVAL_STATUS.approved,
        sortBy: 'submittedOn',
        sortDirection: 'DESC',
        pageNumber: 1,
        pageSize: 6,
      })
      .subscribe({
        next: (page) => this.recent.set(page.items),
        error: () => this.recent.set([]),
      });
  }

  protected readonly requestType = REQUEST_TYPE;
}
