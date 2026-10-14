import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiBadgeComponent, UiBadgeTone } from 'jp-shared/ui';

import { ModerationService, ReportRow } from '../../../core/moderation.service';

/**
 * The reports queue. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔒 THE ONE SCREEN IN THE PRODUCT THAT KNOWS WHO REPORTED SOMETHING
 * ----------------------------------------------------------------------------
 * `GET /api/admin/desk/reports` is the only endpoint anywhere that returns a
 * reporter's uid. No school-facing or teacher-facing response carries it, 025
 * guards the column's projection in SQL by naming the only procedures allowed
 * to select it, and 7B's verification reads the raw bytes of every response
 * the reported party can fetch to prove its absence.
 *
 * ⚠️ WHAT IS SHOWN IS A UID AND A COUNT, NOT A NAME. The question a moderator
 * actually has is "is this one person reporting everything?" — and a count of
 * that account's reports answers it without putting a teacher's name on the
 * screen beside a complaint about their school.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE REPORTED PARTY IS NEVER TOLD WHO COMPLAINED
 * ----------------------------------------------------------------------------
 * Not a design preference: a school that learns which teacher reported it can
 * retaliate, and the teacher is usually someone who applied to them. The
 * moderation remarks a school reads are written on the JOB (2.62) and name
 * nothing about the complaint.
 *
 * ----------------------------------------------------------------------------
 * 🔒 MODERATION.REPORT, CHECKED BY THE SERVER
 * ----------------------------------------------------------------------------
 * A different permission from MODERATION.JOB, deliberately: reading
 * complaints — which means reading who filed them — is a narrower grant than
 * taking an advert down. 7B's verification forces the negative with a
 * VERIFICATION_ADMIN, who holds neither.
 */
@Component({
  selector: 'app-report-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, UiBadgeComponent],
  templateUrl: './report-queue.component.html',
  styleUrl: './report-queue.component.scss',
})
export class ReportQueueComponent {
  private readonly moderation = inject(ModerationService);

  protected readonly rows = signal<ReportRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);

  /** 🔴 A failed read is not an empty queue. */
  protected readonly failed = signal(false);

  // ---- filters -------------------------------------------------------------

  protected readonly statusId = signal<number | null>(null);
  protected readonly entityType = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;

  /** m_app_report_status. 3 and 4 are terminal. */
  protected readonly statuses = [
    { id: 1, label: 'Open' },
    { id: 2, label: 'Under review' },
    { id: 3, label: 'Action taken' },
    { id: 4, label: 'Dismissed' },
  ];

  protected readonly entityTypes = [
    { code: 'JOB', label: 'Adverts' },
    { code: 'SCHOOL', label: 'Schools' },
    { code: 'TEACHER', label: 'Teachers' },
  ];

  protected readonly filtered = computed(
    () => this.statusId() !== null || this.entityType() !== null,
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

  // ---- acting --------------------------------------------------------------

  protected readonly open = signal<ReportRow | null>(null);
  protected readonly nextStatusId = signal<number>(2);
  protected readonly adminRemarks = signal('');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<string | null>(null);

  /**
   * 🔴 REMARKS REQUIRED TO CLOSE ONE, not to pick it up.
   *
   * 033's CHECK demands the review trail arrive complete, and a terminal
   * status with no note is a decision nobody can review later. Moving a report
   * to "under review" is just saying you have it, which needs no essay.
   */
  protected readonly closing = computed(() => this.nextStatusId() >= 3);

  protected readonly remarkMissing = computed(
    () => this.closing() && this.adminRemarks().trim().length === 0,
  );

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.moderation
      .searchReports({
        statusId: this.statusId(),
        entityType: this.entityType(),
        pageNumber: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.rows);
          this.total.set(result.totalRecords);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected onFilterChange(): void {
    this.page.set(1);
    this.reload();
  }

  protected clearFilters(): void {
    this.statusId.set(null);
    this.entityType.set(null);
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

  protected start(row: ReportRow): void {
    this.open.set(row);
    this.outcome.set(null);

    /*
      Opens on the next sensible step rather than on the row's own status:
      an OPEN report is being picked up (2), and one already under review is
      being decided (3). Nobody opens this panel to leave things as they were.
    */
    this.nextStatusId.set(row.statusCode === 'OPEN' ? 2 : 3);
    this.adminRemarks.set(row.adminRemarks ?? '');
  }

  protected cancel(): void {
    this.open.set(null);
  }

  protected confirm(): void {
    const report = this.open();
    if (!report || this.submitting() || this.remarkMissing()) return;

    this.submitting.set(true);

    this.moderation
      .updateReportStatus(
        report.reportUid,
        this.nextStatusId(),
        this.adminRemarks().trim() || null,
      )
      .subscribe({
        next: (message) => {
          this.submitting.set(false);
          this.outcome.set(message);
          this.open.set(null);
          this.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  // ---- presentation --------------------------------------------------------

  protected tone(row: ReportRow): UiBadgeTone {
    switch (row.statusCode) {
      case 'OPEN': return 'danger';
      case 'UNDER_REVIEW': return 'warning';
      case 'ACTION_TAKEN': return 'success';
      default: return 'neutral';
    }
  }

  protected isOpen(row: ReportRow): boolean {
    return row.statusCode === 'OPEN' || row.statusCode === 'UNDER_REVIEW';
  }

  protected entityLabel(code: string): string {
    switch (code) {
      case 'JOB': return 'Advert';
      case 'SCHOOL': return 'School';
      default: return 'Teacher';
    }
  }

  /**
   * 🔒 The reporter, as the admin sees them: the first segment of the uid.
   *
   * ⚠️ Shortened for the eye, never for secrecy — the full uid is in the
   * response and that is deliberate, because an admin tracing a pattern needs
   * to match it against another row. What is NOT here, and never will be, is
   * their name.
   */
  protected reporterTag(row: ReportRow): string {
    return row.reportedByUserUid.split('-')[0];
  }

  protected moment(value: string | null): string {
    if (!value) return '—';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
  }
}
