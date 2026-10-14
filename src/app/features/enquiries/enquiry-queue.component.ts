import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Enquiry, EnquiryService } from '../../core/enquiry.service';

/**
 * The contact queue — messages from the public form. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔒 THE ONE ADMIN SCREEN THAT LEGITIMATELY SHOWS AN EMAIL ADDRESS
 * ----------------------------------------------------------------------------
 * 2.56 forbids a TEACHER'S contact reaching a school without the teacher's
 * consent. A visitor who filled in the contact form asking to be replied to
 * has given exactly that consent, about themselves, and no teacher row is
 * involved: 033's table has no user id at all, because the form is anonymous
 * and no token is read on the public route even if one is sent (7A).
 *
 * ⚠️ So the email is here, and a `mailto:` is how a reply happens. There is
 * no outbound mail from this screen — nothing in the product sends mail on an
 * admin's behalf, and a button that looked like it did would be a lie about
 * where the reply came from.
 *
 * ----------------------------------------------------------------------------
 * 🔴 RESOLVING IS A RECORD, NOT A STATE FLIP
 * ----------------------------------------------------------------------------
 * 033's CHECK demands the whole trail together: resolved, by whom, when, and
 * what they were told. So the remarks are required — "resolved" on its own
 * tells the next person nothing, and the next person is often the same person
 * in a month.
 *
 * 🔒 ENQUIRY.MANAGE. Not MODERATION.REPORT: reading complaints should not
 * carry the right to read every visitor's email address. The structure allows
 * granting it to MODERATION_ADMIN later in one seed line if support and
 * moderation turn out to be the same people; splitting a permission after the
 * fact does not work that way round.
 */
@Component({
  selector: 'app-enquiry-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './enquiry-queue.component.html',
  styleUrl: './enquiry-queue.component.scss',
})
export class EnquiryQueueComponent {
  private readonly enquiries = inject(EnquiryService);

  protected readonly rows = signal<Enquiry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly outcome = signal<string | null>(null);

  // ---- filters -------------------------------------------------------------

  /**
   * ⚠️ `false` IS A REAL FILTER, not an absent one — "show me the unanswered".
   * null means every enquiry. The service sends it with an explicit null check
   * for exactly this reason.
   */
  protected readonly isResolved = signal<boolean | null>(false);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;

  protected readonly totalPages = computed(
    () => Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  protected readonly rangeStart = computed(
    () => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize + 1),
  );

  protected readonly rangeEnd = computed(
    () => Math.min(this.page() * this.pageSize, this.total()),
  );

  // ---- answering -----------------------------------------------------------

  protected readonly open = signal<Enquiry | null>(null);
  protected readonly remarks = signal('');
  protected readonly submitting = signal(false);

  protected readonly remarkMissing = computed(() => this.remarks().trim().length === 0);

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.enquiries
      .search({
        isResolved: this.isResolved(),
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

  protected setFilter(value: boolean | null): void {
    this.isResolved.set(value);
    this.page.set(1);
    this.reload();
  }

  protected goToPage(next: number): void {
    if (next < 1 || next > this.totalPages() || next === this.page()) return;

    this.page.set(next);
    this.reload();
  }

  protected pageNumbers(): number[] {
    return Array.from({ length: this.totalPages() }, (_, index) => index + 1);
  }

  protected start(row: Enquiry): void {
    this.open.set(row);
    this.remarks.set('');
    this.outcome.set(null);
  }

  protected cancel(): void {
    this.open.set(null);
  }

  protected confirm(): void {
    const enquiry = this.open();
    if (!enquiry || this.submitting() || this.remarkMissing()) return;

    this.submitting.set(true);

    this.enquiries.resolve(enquiry.enquiryId, this.remarks().trim()).subscribe({
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

  /**
   * A `mailto:` with the subject already quoted back.
   *
   * ⚠️ The body is left empty on purpose. A pre-written greeting in somebody
   * else's voice is worse than no greeting, and the person replying is about
   * to type anyway.
   */
  protected replyHref(row: Enquiry): string {
    return `mailto:${encodeURIComponent(row.email)}`
      + `?subject=${encodeURIComponent(`Re: ${row.subject}`)}`;
  }

  protected moment(value: string | null): string {
    if (!value) return '—';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
  }

  /**
   * How long it has been waiting, in whole days.
   *
   * 🔴 The number that matters on this screen. "Received 3 October" needs
   * arithmetic; "waiting 11 days" does not, and an inbox is judged by its
   * oldest unanswered message.
   */
  protected waitingDays(row: Enquiry): number {
    const at = new Date(row.createdOn.endsWith('Z') ? row.createdOn : `${row.createdOn}Z`);

    return Math.floor((Date.now() - at.getTime()) / 86_400_000);
  }
}
