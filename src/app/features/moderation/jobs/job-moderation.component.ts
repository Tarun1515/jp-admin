import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiBadgeComponent, UiBadgeTone } from 'jp-shared/ui';

import {
  ModeratableJob,
  ModerationEntry,
  ModerationService,
} from '../../../core/moderation.service';

/** What the panel is open to do. */
type Intent = 'pull' | 'restore';

/**
 * Job moderation — the advert queue, and pulling or restoring one. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS SCREEN IS FOR
 * ----------------------------------------------------------------------------
 * Somebody has complained about an advert, or a moderator has spotted one.
 * The queue puts the complained-about first, then the already-pulled (because
 * a pull is a decision somebody may need to revisit), then the newest.
 *
 * ⚠️ A PULLED JOB IS IN THIS LIST, and must be: restoring one is unreachable
 * otherwise. The status column says which, in words.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE APPLICATION COUNT IS ON THE ROW, AND IT IS THE POINT
 * ----------------------------------------------------------------------------
 * Pulling an advert with nine applications affects nine people who did nothing
 * wrong — and their applications are left exactly as they were: the procedure
 * behind this queue may COUNT them and is structurally unable to WRITE one
 * (025 asserts that through is_updated, having watched the check fail both
 * ways). The count is here so the decision is made knowing the weight of it,
 * not to imply the candidates are affected.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE REMARKS ARE NOT A NOTE TO SELF
 * ----------------------------------------------------------------------------
 * They are what the SCHOOL is shown on its own job (2.62 — not allowed,
 * stated). The field says so, because a moderator who thinks they are writing
 * an internal note writes something different from one who knows the school
 * will read it.
 *
 * The server requires them, so this screen asks first rather than instead.
 *
 * ----------------------------------------------------------------------------
 * 🔒 MODERATION.JOB — AND THIS SCREEN DOES NOT CHECK IT
 * ----------------------------------------------------------------------------
 * The server checks it on every call and the menu row carries the same code,
 * so the link is never offered to anyone else. Re-checking here would be a
 * second answer to a question the server already answers.
 */
@Component({
  selector: 'app-job-moderation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiBadgeComponent],
  templateUrl: './job-moderation.component.html',
  styleUrl: './job-moderation.component.scss',
})
export class JobModerationComponent {
  private readonly moderation = inject(ModerationService);

  protected readonly rows = this.moderation.jobs;
  protected readonly total = this.moderation.jobsTotal;
  protected readonly loading = this.moderation.jobsLoading;
  protected readonly failed = this.moderation.jobsFailed;

  // ---- the filter strip ----------------------------------------------------

  protected readonly search = signal('');
  protected readonly statusId = signal<number | null>(null);
  protected readonly reportedOnly = signal(false);
  protected readonly page = signal(1);

  protected readonly pageSize = 20;

  /**
   * ⚠️ Effective statuses (2.65), and EXPIRED is in the list even though no
   * row stores it. A moderator filtering by what the site shows would
   * otherwise get a list that disagrees with the site.
   */
  protected readonly statuses = [
    { id: 2, label: 'Live' },
    { id: 3, label: 'Expired' },
    { id: 4, label: 'Closed' },
    { id: 5, label: 'Pulled' },
    { id: 1, label: 'Draft' },
  ];

  protected readonly filtered = computed(
    () => this.search().trim().length > 0 || this.statusId() !== null || this.reportedOnly(),
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

  /** The job whose panel is open, and what it is open to do. */
  protected readonly open = signal<ModeratableJob | null>(null);
  protected readonly intent = signal<Intent>('pull');
  protected readonly remarks = signal('');
  protected readonly submitting = signal(false);

  /** The log for the open job. Loaded when the panel opens, not before. */
  protected readonly history = signal<ModerationEntry[]>([]);
  protected readonly historyLoading = signal(false);

  /** The server's own words after the last action. */
  protected readonly outcome = signal<string | null>(null);

  protected readonly remarkMissing = computed(() => this.remarks().trim().length === 0);

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.moderation.loadJobs({
      statusId: this.statusId(),
      search: this.search().trim() || null,
      reportedOnly: this.reportedOnly(),
      pageNumber: this.page(),
      pageSize: this.pageSize,
    });
  }

  /** Any filter change goes back to page 1 — page 4 of a new filter is noise. */
  protected onFilterChange(): void {
    this.page.set(1);
    this.reload();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.statusId.set(null);
    this.reportedOnly.set(false);
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

  protected start(row: ModeratableJob, intent: Intent): void {
    this.open.set(row);
    this.intent.set(intent);
    this.remarks.set('');
    this.outcome.set(null);

    /*
      The history is loaded with the panel, not with the queue. A table of
      fifty rows would be fifty requests for something nobody has looked at
      yet — and the log is exactly what the moderator wants in front of them
      at the moment of deciding, which is now.
    */
    this.history.set([]);
    this.historyLoading.set(true);

    this.moderation.history(row.jobUid).subscribe({
      next: (entries) => {
        this.history.set(entries);
        this.historyLoading.set(false);
      },
      error: () => this.historyLoading.set(false),
    });
  }

  protected cancel(): void {
    this.open.set(null);
    this.history.set([]);
  }

  protected confirm(): void {
    const job = this.open();
    if (!job || this.submitting() || this.remarkMissing()) return;

    this.submitting.set(true);

    const remarks = this.remarks().trim();
    const call = this.intent() === 'pull'
      ? this.moderation.pull(job.jobUid, remarks)
      : this.moderation.restore(job.jobUid, remarks);

    call.subscribe({
      next: (message) => {
        this.submitting.set(false);
        this.outcome.set(message);
        this.open.set(null);
        this.history.set([]);

        /*
          🔴 Reloaded rather than patched in place. The row's status, its last
          action and its position in the queue all change together, and the
          server decides the ordering — a client that edited one field would
          leave a row sitting where it no longer belongs.
        */
        this.reload();
      },
      error: () => {
        this.submitting.set(false);

        /*
          ⚠️ No message of our own: the interceptor shows the server's, which
          carries the real reason — a job somebody else pulled a moment ago,
          or one that was never live.
        */
      },
    });
  }

  // ---- presentation --------------------------------------------------------

  /** Pulled jobs are restored; everything else can be pulled. */
  protected isPulled(row: ModeratableJob): boolean {
    return row.effectiveStatusId === 5;
  }

  /**
   * ⚠️ A DRAFT CANNOT BE PULLED, and the button is ABSENT rather than
   * disabled — the 3F/3G rule. Nobody can see a draft, so there is nothing to
   * take down; the server refuses it and this screen does not offer it.
   */
  protected canPull(row: ModeratableJob): boolean {
    return row.effectiveStatusId !== 1 && row.effectiveStatusId !== 5;
  }

  protected tone(row: ModeratableJob): UiBadgeTone {
    switch (row.effectiveStatusId) {
      case 2: return 'success';
      case 5: return 'danger';
      case 1: return 'warning';
      default: return 'neutral';
    }
  }

  /**
   * The day, in IST.
   *
   * ⚠️ Storage is UTC and the rules are IST (2.28). The zone is named, so a
   * moderator abroad reads the same date off the same row as one in Mumbai.
   */
  protected day(value: string | null): string {
    if (!value) return '—';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  }

  /** Date and time, for the log — the minute matters when two people act. */
  protected moment(value: string): string {
    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
  }

  /** PULL and RESTORE in the words a person would use. */
  protected actionLabel(action: string): string {
    return action === 'PULL' ? 'Pulled' : 'Restored';
  }
}
