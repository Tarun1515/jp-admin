import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToastService } from 'jp-shared/core';

import { OrphanedApproval } from 'jp-shared/models';
import { ApprovalService } from '../../core/approval.service';

/**
 * Approvals that completed while the work after them did not.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHY THIS SECTION EXISTS
 * ----------------------------------------------------------------------------
 * There is no distributed transaction across jp_sso, jp_mdm and jp_app
 * (decision 2.2), so an approval can commit and the school it should have
 * created can fail to appear. The account is then Active with nothing behind
 * it: the person signs in successfully and lands on an empty workspace, with
 * no error anywhere and nobody aware.
 *
 * `USP_FindOrphanedApprovals` has been able to FIND that since Phase 2D. Until
 * this component, nobody could ACT on it — the fix was a DBA calling a stored
 * procedure by hand, which meant a school that had registered and could not
 * use the product was waiting on somebody's database access.
 *
 * So: a list, a reason, and a button.
 *
 * ----------------------------------------------------------------------------
 * EMPTY IS THE ANSWER WE EXPECT
 * ----------------------------------------------------------------------------
 * This renders nothing at all when the list is empty. Not "0 orphaned
 * approvals" — a permanent zero on a dashboard is furniture, and furniture is
 * what the eye stops seeing. The section appearing at all IS the signal.
 */
@Component({
  selector: 'app-orphaned-approvals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './orphaned-approvals.component.html',
  styleUrl: './orphaned-approvals.component.scss',
})
export class OrphanedApprovalsComponent {
  private readonly approvals = inject(ApprovalService);
  private readonly toast = inject(ToastService);

  protected readonly rows = signal<OrphanedApproval[]>([]);
  protected readonly loading = signal(true);

  /** Which request is being retried, so only its own button says so. */
  protected readonly retrying = signal<number | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);

    this.approvals.orphaned().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        // Reported by the interceptor. Showing an empty section on a failed
        // check would claim "all clear", which is the one thing this must
        // never say without having looked.
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  /**
   * Runs the outstanding work again.
   *
   * Safe to press twice: provisioning keys on the request, and activation
   * treats an already-active account as success. The worst a double click does
   * is ask the same question twice.
   */
  protected retry(row: OrphanedApproval): void {
    this.retrying.set(row.requestId);

    this.approvals.retryOrchestration(row.requestId).subscribe({
      next: (result) => {
        this.retrying.set(null);

        if (result.orchestrationCompleted) {
          this.toast.success(`${row.requestNo} is now complete. ${row.entityName ?? ''}`.trim());

          // Drop it from the list rather than reloading: the reconciliation
          // query is not free, and the row has demonstrably been dealt with.
          this.rows.update((all) => all.filter((r) => r.requestId !== row.requestId));
          return;
        }

        // Failed again, for the same or a new reason. Say so and leave the row
        // where it is — it is still broken.
        this.toast.error(
          result.orchestrationError ??
            `${row.requestNo} could not be completed. It is still outstanding.`,
        );
      },
      error: () => this.retrying.set(null),
    });
  }

  /** "3 hours" / "2 days" — how long somebody has had a broken account. */
  protected age(hours: number): string {
    if (hours < 1) return 'less than an hour';
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

    const days = Math.floor(hours / 24);

    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
}
