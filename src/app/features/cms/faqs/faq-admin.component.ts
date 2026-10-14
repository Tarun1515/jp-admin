import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiBadgeComponent } from 'jp-shared/ui';

import { AdminFaq, ContentService } from '../../../core/content.service';

/**
 * The FAQs the public site shows. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE PUBLIC PAGE SHOWS ONLY THE ACTIVE ONES, AND THIS SCREEN SHOWS ALL
 * ----------------------------------------------------------------------------
 * That difference is the feature: switching one off is how a question is
 * retired without losing the answer somebody wrote. The list says which are
 * live and which are not, in words.
 *
 * ⚠️ DELETE IS A SOFT DELETE. The row stays, with Is_Deleted = 1, because an
 * answer that took a phone call to a client to get right should not be
 * destroyed by a mis-click. "Switch it off" is the reversible act and is what
 * the screen offers first.
 *
 * ----------------------------------------------------------------------------
 * THE CATEGORY IS FREE TEXT, AND THAT IS DELIBERATE
 * ----------------------------------------------------------------------------
 * 003's seed uses TEACHER and SCHOOL, which is what the public FAQ page groups
 * by. A master table would be one more screen for a two-row list — but the
 * existing values are offered as a datalist so nobody invents 'Teachers' and
 * splits the page in two.
 *
 * 🔒 CMS.MANAGE. The server checks it; the menu row carries it.
 */
@Component({
  selector: 'app-faq-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiBadgeComponent],
  templateUrl: './faq-admin.component.html',
  styleUrl: './faq-admin.component.scss',
})
export class FaqAdminComponent {
  private readonly content = inject(ContentService);

  protected readonly rows = signal<AdminFaq[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly outcome = signal<string | null>(null);

  // ---- the form ------------------------------------------------------------

  /** The FAQ being edited, or null when the form is for a new one. */
  protected readonly editing = signal<AdminFaq | null>(null);
  protected readonly formOpen = signal(false);

  protected readonly category = signal('TEACHER');
  protected readonly question = signal('');
  protected readonly answer = signal('');
  protected readonly displayOrder = signal(10);
  protected readonly isActive = signal(true);
  protected readonly submitting = signal(false);

  /** Every category already in use, so nobody invents a second spelling. */
  protected readonly categories = computed(
    () => [...new Set(this.rows().map((r) => r.category))].sort(),
  );

  /** Grouped the way the public page groups them. */
  protected readonly grouped = computed(() => {
    const groups = new Map<string, AdminFaq[]>();

    for (const row of this.rows()) {
      const list = groups.get(row.category) ?? [];
      list.push(row);
      groups.set(row.category, list);
    }

    return [...groups.entries()]
      .map(([category, faqs]) => ({ category, faqs }))
      .sort((a, b) => a.category.localeCompare(b.category));
  });

  protected readonly liveCount = computed(() => this.rows().filter((r) => r.isActive).length);

  protected readonly cannotSave = computed(
    () => this.question().trim().length === 0
      || this.answer().trim().length === 0
      || this.category().trim().length === 0,
  );

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.content.listFaqs().subscribe({
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

  protected startNew(): void {
    this.editing.set(null);
    this.formOpen.set(true);
    this.outcome.set(null);

    this.category.set(this.categories()[0] ?? 'TEACHER');
    this.question.set('');
    this.answer.set('');

    /*
      ⚠️ Ten past the highest, not 1. A new FAQ lands at the bottom of its
      group, which is where a new question belongs, and the gaps leave room to
      insert one later without renumbering the lot.
    */
    this.displayOrder.set(
      this.rows().reduce((highest, row) => Math.max(highest, row.displayOrder), 0) + 10,
    );
    this.isActive.set(true);
  }

  protected startEdit(row: AdminFaq): void {
    this.editing.set(row);
    this.formOpen.set(true);
    this.outcome.set(null);

    this.category.set(row.category);
    this.question.set(row.question);
    this.answer.set(row.answer);
    this.displayOrder.set(row.displayOrder);
    this.isActive.set(row.isActive);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  protected save(): void {
    if (this.cannotSave() || this.submitting()) return;

    this.submitting.set(true);

    this.content
      .saveFaq({
        faqId: this.editing()?.faqId ?? null,
        category: this.category().trim(),
        question: this.question().trim(),
        answer: this.answer().trim(),
        displayOrder: this.displayOrder(),
        isActive: this.isActive(),
      })
      .subscribe({
        next: (message) => {
          this.submitting.set(false);
          this.outcome.set(message);
          this.closeForm();
          this.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /**
   * 🔴 THE ONE-CLICK ACT IS THE REVERSIBLE ONE.
   *
   * Switching a FAQ off takes it off the public page and keeps the answer. It
   * is a save of the same row with isActive flipped — no separate endpoint,
   * because "off" is not a different kind of edit.
   */
  protected toggleActive(row: AdminFaq): void {
    this.content
      .saveFaq({
        faqId: row.faqId,
        category: row.category,
        question: row.question,
        answer: row.answer,
        displayOrder: row.displayOrder,
        isActive: !row.isActive,
      })
      .subscribe({
        next: (message) => {
          this.outcome.set(message);
          this.reload();
        },
      });
  }

  // ---- deleting ------------------------------------------------------------

  /**
   * ⚠️ TWO-STEP, AND NOT WITH `confirm()`.
   *
   * The row asks for a second click in place. A browser dialog cannot be
   * styled, cannot be reached by the design system's focus handling, and in
   * some embedded views does not appear at all — which would turn a confirmed
   * delete into a silent one.
   */
  protected readonly confirmingDelete = signal<number | null>(null);

  protected askDelete(row: AdminFaq): void {
    this.confirmingDelete.set(row.faqId);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(row: AdminFaq): void {
    this.content.deleteFaq(row.faqId).subscribe({
      next: (message) => {
        this.confirmingDelete.set(null);
        this.outcome.set(message);
        this.reload();
      },
      error: () => this.confirmingDelete.set(null),
    });
  }

  // ---- presentation --------------------------------------------------------

  protected categoryLabel(code: string): string {
    switch (code) {
      case 'TEACHER': return 'For teachers';
      case 'SCHOOL': return 'For schools';
      default: return code;
    }
  }

  protected day(value: string | null): string {
    if (!value) return 'never edited';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  }
}
