import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiBadgeComponent } from 'jp-shared/ui';

import { AdminContentBlock, ContentService } from '../../../core/content.service';

/**
 * Page content — designated copy, addressed by key. Phase 7B.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHERE THIS COPY APPEARS — G44, CLOSED IN PHASE 8-0
 * ----------------------------------------------------------------------------
 * A block whose key begins `HOME_` renders on jp-public's home page, ordered
 * by DisplayOrder. Any other key is stored and served at
 * `GET /api/public/content-blocks` and read by no page — which the banner on
 * this screen states, because an editor who cannot tell those two cases apart
 * will read the second as a broken save.
 *
 * ⚠️ READ IN THE BROWSER, AFTER HYDRATION, and that is 2.81's decision for
 * that page rather than an accident: the home page is prerendered, so a block
 * read at render time would be baked at build time and an edit would need a
 * redeploy. Read client-side, an edit appears on the next load.
 *
 * The consequence is that block copy is NOT in the server's HTML, and
 * `public-screens.mjs` asserts that in both directions — present in a
 * browser, absent from the prerendered bytes — so the trade-off cannot be
 * reversed by accident.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE KEY IS THE CONTRACT
 * ----------------------------------------------------------------------------
 * A page asks for a block BY KEY. Renaming one is not an edit — it
 * unpublishes the old block and creates a new one that nothing asks for. The
 * form says that where the key is typed, and editing an existing block shows
 * the key read-only.
 *
 * 🔒 CMS.MANAGE, checked by the server on every call.
 */
@Component({
  selector: 'app-content-blocks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiBadgeComponent],
  templateUrl: './content-blocks.component.html',
  styleUrl: './content-blocks.component.scss',
})
export class ContentBlocksComponent {
  private readonly content = inject(ContentService);

  protected readonly rows = signal<AdminContentBlock[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly outcome = signal<string | null>(null);

  // ---- the form ------------------------------------------------------------

  protected readonly editing = signal<AdminContentBlock | null>(null);
  protected readonly formOpen = signal(false);

  protected readonly blockKey = signal('');
  protected readonly blockTitle = signal('');
  protected readonly blockContent = signal('');
  protected readonly imagePath = signal('');
  protected readonly displayOrder = signal(10);
  protected readonly isActive = signal(true);
  protected readonly submitting = signal(false);

  protected readonly liveCount = computed(() => this.rows().filter((r) => r.isActive).length);

  /**
   * ⚠️ UPPER_SNAKE, because every key already in the product is — and a
   * mixture of HOME_HERO and home-hero is two keys nobody can remember. The
   * server stores what it is given; this is the client being consistent, and
   * it only warns rather than refusing.
   */
  protected readonly keyLooksOdd = computed(() => {
    const value = this.blockKey().trim();

    return value.length > 0 && !/^[A-Z][A-Z0-9_]*$/.test(value);
  });

  protected readonly cannotSave = computed(
    () => this.blockKey().trim().length === 0 || this.blockContent().trim().length === 0,
  );

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.content.listContentBlocks().subscribe({
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

    this.blockKey.set('');
    this.blockTitle.set('');
    this.blockContent.set('');
    this.imagePath.set('');
    this.displayOrder.set(
      this.rows().reduce((highest, row) => Math.max(highest, row.displayOrder), 0) + 10,
    );
    this.isActive.set(true);
  }

  protected startEdit(row: AdminContentBlock): void {
    this.editing.set(row);
    this.formOpen.set(true);
    this.outcome.set(null);

    this.blockKey.set(row.blockKey);
    this.blockTitle.set(row.blockTitle ?? '');
    this.blockContent.set(row.blockContent);
    this.imagePath.set(row.imagePath ?? '');
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
      .saveContentBlock({
        blockKey: this.blockKey().trim(),
        blockTitle: this.blockTitle().trim() || null,
        blockContent: this.blockContent(),
        imagePath: this.imagePath().trim() || null,
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
   * 🔴 OFF IS THE REVERSIBLE ACT, AND THERE IS NO DELETE AT ALL HERE.
   *
   * A block is addressed by key, so removing one means a page asking for copy
   * that no longer exists. Switching it off stops it being served and keeps
   * the words — and the server's upsert makes turning it back on one click.
   */
  protected toggleActive(row: AdminContentBlock): void {
    this.content
      .saveContentBlock({
        blockKey: row.blockKey,
        blockTitle: row.blockTitle,
        blockContent: row.blockContent,
        imagePath: row.imagePath,
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

  protected day(value: string | null): string {
    if (!value) return 'never edited';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  }
}
