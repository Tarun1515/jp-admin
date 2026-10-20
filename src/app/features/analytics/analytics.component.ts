import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { UiBadgeComponent } from 'jp-shared/ui';

import {
  AnalyticsService,
  ApprovalCount,
  QueueWait,
  RegistrationCount,
  StatusCount,
} from '../../core/analytics.service';

/**
 * Platform analytics. Phase 8-0 — §3's "Reports/dashboard", honestly.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHAT IT REFUSES TO BE
 * ----------------------------------------------------------------------------
 * It is not a chart wall. Every figure here is a number somebody acts on: how
 * many accounts arrived, what is waiting and for how long, where applications
 * stall. Nothing is plotted over time, because the product has no history
 * table to plot — a line chart built from thirty days of CreatedOn would look
 * like a trend and be an artefact of when seeding happened.
 *
 * ⚠️ NO NEW COUNTERS WERE ADDED FOR IT, and none may be. Every number is a
 * COUNT over rows, because one phase ago the moderation queue read a
 * denormalised column that the product forbids maintaining and reported
 * "0 applied" for every advert. 027, 010 and 011 each carry a build guard.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE OLDEST WAIT IS THE HEADLINE, NOT THE TOTAL
 * ----------------------------------------------------------------------------
 * "Four pending verifications" is fine if none is a day old and a problem if
 * one has waited three weeks. The queue table leads with the wait and the
 * screen marks it when it crosses a week — a threshold stated in one place
 * here rather than implied by a colour.
 *
 * ----------------------------------------------------------------------------
 * 🔒 HOW MANY, NEVER WHO
 * ----------------------------------------------------------------------------
 * No email, no uid, no request number, no school or teacher name reaches this
 * screen, and the two identity databases' procedures fail the build if one
 * ever does. REPORT.VIEW is not USER.MANAGE: whoever reads the totals is not
 * thereby trusted with the people in them, and one account at a time is the
 * Accounts screen's job.
 */
@Component({
  selector: 'app-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadgeComponent],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent {
  private readonly analytics = inject(AnalyticsService);

  protected readonly data = this.analytics.data;
  protected readonly loading = this.analytics.isLoading;
  protected readonly failed = this.analytics.hasFailed;

  /**
   * ⚠️ A WEEK. Stated once, here, rather than left to a colour in the
   * template — a threshold nobody can find is a threshold nobody can argue
   * with, and this one is a guess that deserves to be argued with.
   */
  protected readonly WAITING_TOO_LONG_DAYS = 7;

  /** Only the queues that actually have something open. */
  protected readonly openQueues = computed<QueueWait[]>(
    () => (this.data()?.waits ?? []).filter((w) => w.stillOpen > 0),
  );

  protected readonly worstWait = computed(
    () => this.openQueues().reduce((worst, w) => Math.max(worst, w.oldestWaitingDays), 0),
  );

  /**
   * Registrations, grouped by user type so each type reads as its own row of
   * statuses rather than eighteen rows in a list.
   */
  protected readonly byType = computed(() => {
    const groups = new Map<string, RegistrationCount[]>();

    for (const row of this.data()?.registrations ?? []) {
      const list = groups.get(row.userTypeName) ?? [];
      list.push(row);
      groups.set(row.userTypeName, list);
    }

    return [...groups.entries()].map(([name, rows]) => ({
      name,
      rows: rows.filter((r) => r.total > 0),
      total: rows.reduce((sum, r) => sum + r.total, 0),
      last30: rows.reduce((sum, r) => sum + r.last30Days, 0),
    }));
  });

  /** Approvals, grouped the same way, and only the types in use. */
  protected readonly byRequestType = computed(() => {
    const groups = new Map<string, ApprovalCount[]>();

    for (const row of this.data()?.approvals ?? []) {
      const list = groups.get(row.requestTypeName) ?? [];
      list.push(row);
      groups.set(row.requestTypeName, list);
    }

    return [...groups.entries()]
      .map(([name, rows]) => ({
        name,
        rows: rows.filter((r) => r.total > 0),
        total: rows.reduce((sum, r) => sum + r.total, 0),
      }))
      .filter((g) => g.total > 0);
  });

  /**
   * 🔴 THE FUNNEL, AND IT KEEPS ITS ZEROES.
   *
   * A stage with no applications is a fact — "nothing has reached Interview" —
   * and dropping it would make the funnel read as a different shape. Only the
   * rendering is quiet, not the row.
   */
  protected readonly funnel = computed<StatusCount[]>(
    () => this.data()?.applications ?? [],
  );

  protected readonly funnelTotal = computed(
    () => this.funnel().reduce((sum, s) => sum + s.total, 0),
  );

  protected readonly jobsLive = computed(
    () => (this.data()?.jobs ?? []).find((j) => j.statusId === 2)?.total ?? 0,
  );

  constructor() {
    this.analytics.load();
  }

  protected waitTone(days: number): 'danger' | 'warning' | 'neutral' {
    if (days >= this.WAITING_TOO_LONG_DAYS * 2) return 'danger';
    if (days >= this.WAITING_TOO_LONG_DAYS) return 'warning';

    return 'neutral';
  }

  /**
   * A share of the funnel, for the bar widths.
   *
   * ⚠️ Guarded against a zero total. Dividing by it would give NaN and the
   * bars would silently vanish on a clean database — which is exactly the
   * state the suites leave behind, so it would be the state anybody
   * demonstrating this screen sees first.
   */
  protected share(value: number): number {
    const total = this.funnelTotal();

    return total === 0 ? 0 : Math.round((value / total) * 100);
  }

  /** The date the numbers are as of, in IST — the server computed it. */
  protected asOf(): string {
    const raw = this.data()?.appTotals?.asOfIst;
    if (!raw) return '—';

    return new Date(`${raw.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }
}
