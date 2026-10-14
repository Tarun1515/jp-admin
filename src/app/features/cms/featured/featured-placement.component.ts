import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiBadgeComponent } from 'jp-shared/ui';

import { ContentService, FeaturedWindow } from '../../../core/content.service';

/**
 * Featured placement — what gets promoted on the public site. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔴 A DATE RANGE, NOT A FLAG — AND THE SCREEN SAYS SO
 * ----------------------------------------------------------------------------
 * There is no IsFeatured column anywhere in the database and no job that runs
 * at midnight to clear one. A window is live when today-in-IST falls inside
 * it, computed on every read. The consequence is worth stating because it is
 * the reason this screen has no "unfeature" button for a window that has
 * ended: nothing ran to end it, and nothing needed to.
 *
 * ⚠️ `isLiveToday` IS THE SERVER'S ANSWER AND IS NEVER RECOMPUTED HERE. A
 * browser in London asking "is today inside this window" gets a different
 * answer from the database for five and a half hours a day (2.28), and the
 * public listing is ordered by the database's answer.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ WHAT THE DATE INPUTS SEND
 * ----------------------------------------------------------------------------
 * `yyyy-MM-dd`, exactly as `<input type="date">` gives it, because the columns
 * are `date`. Sending an instant would put the boundary at 05:30 IST for
 * anybody who wrote it as UTC midnight — the trap t_app_jobs.LastDateToApply
 * records in its own comment.
 *
 * ----------------------------------------------------------------------------
 * 🔒 CMS.MANAGE
 * ----------------------------------------------------------------------------
 * The same permission as FAQs and page copy, because all three decide what a
 * visitor who is not signed in sees. A MODERATION_ADMIN does NOT hold it, and
 * 7B's verification proves that with a 403 on this exact route.
 */
@Component({
  selector: 'app-featured-placement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LowerCasePipe, UiBadgeComponent],
  templateUrl: './featured-placement.component.html',
  styleUrl: './featured-placement.component.scss',
})
export class FeaturedPlacementComponent {
  private readonly content = inject(ContentService);

  protected readonly rows = signal<FeaturedWindow[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly outcome = signal<string | null>(null);

  // ---- the form ------------------------------------------------------------

  protected readonly formOpen = signal(false);
  protected readonly featuredType = signal<string>('JOB');
  protected readonly entityUid = signal('');
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly displayOrder = signal(1);
  protected readonly submitting = signal(false);

  protected readonly live = computed(() => this.rows().filter((r) => r.isLiveToday));
  protected readonly scheduled = computed(
    () => this.rows().filter((r) => !r.isLiveToday && r.toDate >= this.todayIso()),
  );
  protected readonly finished = computed(
    () => this.rows().filter((r) => !r.isLiveToday && r.toDate < this.todayIso()),
  );

  /**
   * ⚠️ A uid, typed or pasted. Validated on shape only — whether it names a
   * live job is the server's question, and it answers 404-class if not.
   */
  protected readonly uidLooksWrong = computed(() => {
    const value = this.entityUid().trim();

    return value.length > 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
  });

  protected readonly datesWrong = computed(() => {
    const from = this.fromDate();
    const to = this.toDate();

    return from.length > 0 && to.length > 0 && to < from;
  });

  protected readonly cannotSave = computed(
    () => this.entityUid().trim().length === 0
      || this.fromDate().length === 0
      || this.toDate().length === 0
      || this.uidLooksWrong()
      || this.datesWrong(),
  );

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.content.listFeatured().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected openForm(): void {
    this.formOpen.set(true);
    this.outcome.set(null);
    this.featuredType.set('JOB');
    this.entityUid.set('');

    /*
      Pre-filled with today and a week out, because that is the common case —
      "put this up now". An empty pair of dates makes the common case the
      slowest one.
    */
    this.fromDate.set(this.todayIso());
    this.toDate.set(this.isoDaysFromToday(7));
    this.displayOrder.set(1);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected save(): void {
    if (this.cannotSave() || this.submitting()) return;

    this.submitting.set(true);

    this.content
      .saveFeatured({
        featuredType: this.featuredType(),
        entityUid: this.entityUid().trim(),
        fromDate: this.fromDate(),
        toDate: this.toDate(),
        displayOrder: this.displayOrder(),
      })
      .subscribe({
        next: (message) => {
          this.submitting.set(false);
          this.outcome.set(message);
          this.formOpen.set(false);
          this.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /**
   * Remove a placement.
   *
   * 🔴 A soft delete of the WINDOW, never a change to the thing featured. The
   * job carries on exactly as it was — being promoted and being published are
   * two decisions, and this screen owns only the first.
   */
  protected remove(row: FeaturedWindow): void {
    this.content.removeFeatured(row.featuredType, row.featuredId).subscribe({
      next: (message) => {
        this.outcome.set(message);
        this.reload();
      },
    });
  }

  // ---- dates ---------------------------------------------------------------

  /**
   * 🔴 TODAY IN IST, as `yyyy-MM-dd`.
   *
   * ⚠️ Built from the en-CA locale in Asia/Kolkata rather than
   * `toISOString().slice(0, 10)`, which is today in UTC — and for five and a
   * half hours every day those are different dates. The server computes the
   * same thing with `fn_IstToday`, and this is the client agreeing with it
   * rather than guessing.
   */
  protected todayIso(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  private isoDaysFromToday(days: number): string {
    const at = new Date();
    at.setDate(at.getDate() + days);

    return at.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  /** A `date` column, printed as a day. No zone conversion: it has no time. */
  protected day(value: string): string {
    const at = new Date(`${value.slice(0, 10)}T00:00:00`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  protected typeLabel(code: string): string {
    return code === 'SCHOOL' ? 'School' : 'Advert';
  }

  /**
   * ⚠️ A window promoting something that is no longer live is worth saying out
   * loud: the placement is working and the public listing is quietly dropping
   * the job, which looks from the admin's side like featuring doing nothing.
   */
  protected entityIsDown(row: FeaturedWindow): boolean {
    const status = row.entityStatusName;

    return !!status && status !== 'Active';
  }
}
