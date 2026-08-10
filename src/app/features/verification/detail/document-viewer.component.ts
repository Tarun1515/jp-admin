import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { DocumentService } from '../../../core/document.service';

type ViewerState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Renders an uploaded document inline — PDFs and images both.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHY THIS EXISTS AT ALL
 * ----------------------------------------------------------------------------
 * Downloading a file to read it is the single biggest friction in verification
 * work, and it is what makes people approve in batches without looking. If the
 * registration certificate is on screen next to the school name, checking that
 * they match takes two seconds. If it is in the downloads folder, it does not
 * get checked.
 *
 * ----------------------------------------------------------------------------
 * WHY A BLOB AND NOT A URL
 * ----------------------------------------------------------------------------
 * The file comes from GET /api/documents/{id}, which requires the
 * Authorization header and checks entitlement. A browser sends no header for an
 * `<img src>` or an `<iframe src>`, so the file is fetched through HttpClient —
 * where the auth interceptor applies — and handed over as an object URL.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY OBJECT URL IS REVOKED
 * ----------------------------------------------------------------------------
 * An object URL pins its blob in memory until it is revoked or the tab closes.
 * A reviewer works through fifty requests in a sitting, and fifty pinned
 * multi-megabyte PDFs is a tab that slows to a crawl with nothing on screen to
 * explain why.
 *
 * So there are exactly two revoke points and both are needed:
 *   - before replacing a URL, when the reviewer picks a different document
 *   - on destroy, when they leave the screen
 */
@Component({
  selector: 'app-document-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-viewer.component.html',
  styleUrl: './document-viewer.component.scss',
})
export class DocumentViewerComponent {
  private readonly documents = inject(DocumentService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly documentId = input<number | null>(null);
  readonly fileName = input<string>('');
  readonly mimeType = input<string>('');

  protected readonly state = signal<ViewerState>('idle');

  /** The live object URL, or null. Read by the template. */
  private readonly objectUrl = signal<string | null>(null);

  /*
    🔴 THE SAME URL AGAIN, AS A PLAIN FIELD, AND IT HAS TO BE.

    Revoking means reading the current URL, and the only place that happens is
    inside the effect below. Reading the SIGNAL there would make the effect
    depend on it — so setting it after a fetch would re-run the effect, which
    would revoke the URL it just created, and fetch again. Forever, with an
    empty viewer and no error.

    That is not hypothetical: it is what this component did on first write.
    The signal drives the template; this field is the bookkeeping, and nothing
    tracks it.
  */
  private liveUrl: string | null = null;

  /**
   * The same URL, marked safe for `[src]`.
   *
   * Angular strips a `blob:` URL out of an iframe otherwise. Bypassing is
   * correct here and nowhere near a blanket trust: the string was produced by
   * URL.createObjectURL in this component, from bytes this component fetched.
   * Nothing from the server or the user reaches it.
   */
  protected readonly safeUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.objectUrl();

    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  protected readonly isPdf = computed(() => this.mimeType().toLowerCase().includes('pdf'));

  protected readonly isImage = computed(() => this.mimeType().toLowerCase().startsWith('image/'));

  /** Neither a PDF nor an image. Nothing to render, so offer the download. */
  protected readonly isUnpreviewable = computed(() => !this.isPdf() && !this.isImage());

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const id = this.documentId();

      // Reading the id first, then releasing the previous file: switching
      // documents must not leave the old blob pinned.
      this.release();

      if (id === null) {
        this.state.set('idle');
        return;
      }

      this.state.set('loading');

      this.documents.download(id).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);

          this.liveUrl = url;
          this.objectUrl.set(url);
          this.state.set('ready');
        },
        error: () => {
          // The interceptor has already reported it. This just stops the
          // viewer claiming to show something it does not have.
          this.state.set('failed');
        },
      });
    });

    destroyRef.onDestroy(() => this.release());
  }

  /** Revokes the current object URL, if any. Safe to call repeatedly. */
  private release(): void {
    if (this.liveUrl) {
      URL.revokeObjectURL(this.liveUrl);
      this.liveUrl = null;
    }

    this.objectUrl.set(null);
  }

  /**
   * Saves the file.
   *
   * Uses the blob already in memory rather than hitting the endpoint again —
   * the reviewer is looking at it, so the bytes are right here.
   */
  protected save(): void {
    if (!this.liveUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = this.liveUrl;
    link.download = this.fileName() || 'document';
    link.click();
  }
}
