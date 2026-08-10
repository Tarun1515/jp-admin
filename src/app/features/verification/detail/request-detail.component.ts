import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmDialogService, MasterService, ToastService } from 'jp-shared/core';
import {
  ACTION_TYPE,
  APPROVAL_STATUS,
  ApprovalDetail,
  ERROR_CODES,
  Lookup,
  MASTER_KEYS,
  ProcessActionResult,
  REQUEST_TYPE,
  RequestDocument,
} from 'jp-shared/models';
import { UiModalComponent } from 'jp-shared/ui';

import { ApprovalService } from '../../../core/approval.service';
import { DocumentService } from '../../../core/document.service';
import { OutcomeNotice, describeOutcome } from '../../../core/orchestration-outcome';
import { DocumentViewerComponent } from './document-viewer.component';
import { RequestTrailComponent } from './request-trail.component';

/** Which reason dialog is open, and what it is about. */
type Dialog =
  | { kind: 'reject-request' }
  | { kind: 'resubmit-request' }
  | { kind: 'reject-document'; document: RequestDocument }
  | null;

/**
 * A prompt per rejection reason.
 *
 * 🔴 The reason on its own is a category; the school needs an instruction. A
 * bare textarea produces "rejected", and then a phone call — so the placeholder
 * asks for the specific thing that reason implies, keyed on the reason CODE,
 * which is stable (2.47), rather than on its editable name.
 */
const REASON_PROMPTS: Readonly<Record<string, string>> = {
  DOC_UNREADABLE:
    'Which document, and what is wrong with it — blurred, cut off, a page missing?',
  DOC_MISMATCH:
    'Which detail does not match? e.g. the certificate says "Greenwood Public School" and the form says "Greenwood School".',
  NOT_VERIFIABLE: 'What did you check, and what would settle it?',
  DUPLICATE: 'Which existing registration is this a duplicate of?',
  AUTH_INVALID: 'What is missing from the authorisation letter?',
  QUAL_MISMATCH: 'Which qualification, and what does the certificate say instead?',
  ID_INVALID: 'What is wrong with the identity proof?',
  OTHER: 'Say exactly what has to change before they send it back.',
};

/**
 * One verification request: what was submitted, what was uploaded, what has
 * been done to it, and what to do next.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE ONE THING THIS SCREEN MUST GET RIGHT
 * ----------------------------------------------------------------------------
 * Approving returns HTTP 200 even when the work AFTER the approval failed. The
 * approval committed in one database and the account and school live in two
 * others, with no distributed transaction between them (decisions 2.2, 2.48).
 * A 500 would be a lie — the approval genuinely happened.
 *
 * So the result is read through `describeOutcome`, never through the status
 * code, and a partial completion becomes a PERSISTENT banner with a retry
 * rather than a toast. A toast that says "Approved" and disappears is exactly
 * how a school ends up approved, paid up, and unable to sign in, with nobody
 * aware.
 */
@Component({
  selector: 'app-request-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    UiModalComponent,
    DocumentViewerComponent,
    RequestTrailComponent,
  ],
  templateUrl: './request-detail.component.html',
  styleUrl: './request-detail.component.scss',
})
export class RequestDetailComponent {
  private readonly approvals = inject(ApprovalService);
  private readonly documents = inject(DocumentService);
  private readonly masters = inject(MasterService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  /** Route param, bound by `withComponentInputBinding`. */
  readonly id = input.required<string>();

  protected readonly detail = signal<ApprovalDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  /** True while an action is in flight. Disables the buttons rather than queueing clicks. */
  protected readonly acting = signal(false);

  /**
   * The result of the last action, if it still needs saying.
   *
   * Deliberately NOT a toast for anything but a clean success — see the class
   * note. A partial completion has to stay on screen until somebody deals
   * with it.
   */
  protected readonly notice = signal<OutcomeNotice | null>(null);

  protected readonly selectedDocumentId = signal<number | null>(null);

  protected readonly dialog = signal<Dialog>(null);
  protected readonly dialogReasonId = signal<number | ''>('');
  protected readonly dialogRemarks = signal('');
  protected readonly dialogError = signal('');

  protected readonly reasons = signal<Lookup[]>([]);
  private readonly lookups = signal<Record<string, Map<number, string>>>({});

  protected readonly requestId = computed(() => Number(this.id()));

  protected readonly header = computed(() => this.detail()?.header ?? null);

  protected readonly isTeacher = computed(
    () => this.header()?.requestTypeId === REQUEST_TYPE.teacherVerification,
  );

  /** Only an open request can be actioned. Everything else is history. */
  protected readonly isOpen = computed(() => {
    const status = this.header()?.statusId;

    return status === APPROVAL_STATUS.pending || status === APPROVAL_STATUS.resubmitRequired;
  });

  protected readonly isApproved = computed(
    () => this.header()?.statusId === APPROVAL_STATUS.approved,
  );

  protected readonly selectedDocument = computed(() => {
    const id = this.selectedDocumentId();

    return this.detail()?.documents.find((d) => d.documentId === id) ?? null;
  });

  /** Mandatory documents still unverified. Shown next to Approve, not instead of it. */
  protected readonly unverifiedMandatory = computed(
    () => this.detail()?.documents.filter((d) => d.isMandatory && !d.isVerified).length ?? 0,
  );

  protected readonly dialogTitle = computed(() => {
    switch (this.dialog()?.kind) {
      case 'reject-request':
        return 'Reject this registration';
      case 'resubmit-request':
        return 'Ask for a resubmission';
      case 'reject-document':
        return 'Reject this document';
      default:
        return '';
    }
  });

  /** The prompt for whichever reason is currently selected. */
  protected readonly reasonPrompt = computed(() => {
    const id = this.dialogReasonId();
    const reason = this.reasons().find((r) => r.id === id);

    return (reason && REASON_PROMPTS[reason.code]) || 'Add anything that helps them fix it.';
  });

  /**
   * "Other" means the reason itself carries no information, so the note has to.
   */
  protected readonly remarksRequired = computed(() => {
    const id = this.dialogReasonId();

    return this.reasons().find((r) => r.id === id)?.code === 'OTHER';
  });

  constructor() {
    /*
      🔴 NOT `this.load()` IN THE CONSTRUCTOR.

      A required input is not bound until after construction, so reading it
      there throws NG0950 — the component builds, the request never loads, and
      the screen sits on its skeleton with the reason only in the console.

      An effect runs once the input has a value, and again if it changes, which
      also covers navigating from one request straight to another.
    */
    effect(() => {
      const requestId = this.requestId();

      if (Number.isFinite(requestId)) {
        this.load();
      }
    });


    // Masters for turning stored ids back into names. Each is independent, so
    // one failing leaves the rest of the screen readable.
    for (const key of [
      MASTER_KEYS.board,
      MASTER_KEYS.schoolType,
      MASTER_KEYS.state,
      MASTER_KEYS.qualification,
      MASTER_KEYS.gender,
      MASTER_KEYS.subject,
    ] as const) {
      this.masters.get(key).subscribe({
        next: (items) =>
          this.lookups.update((all) => ({
            ...all,
            [key]: new Map(items.map((i) => [i.id, i.name])),
          })),
        error: () => undefined,
      });
    }
  }

  protected load(): void {
    this.loading.set(true);

    this.approvals.getById(this.requestId()).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
        this.notFound.set(false);

        // Open the first document automatically. The whole point of the viewer
        // is that reading a document costs nothing; making the reviewer click
        // once before anything appears puts a little of that cost back.
        this.selectedDocumentId.set(detail.documents[0]?.documentId ?? null);

        this.loadReasons(detail.header.requestTypeId);
      },
      error: () => {
        this.loading.set(false);
        this.notFound.set(true);
      },
    });
  }

  private loadReasons(requestTypeId: number): void {
    // Scoped by request type: a school rejection reason on a teacher request
    // would be nonsense the admin has to read past.
    this.masters.getByParent(MASTER_KEYS.rejectionReason, requestTypeId).subscribe({
      next: (items) => this.reasons.set(items),
      error: () => this.reasons.set([]),
    });
  }

  protected lookup(key: string, id: number | null | undefined): string {
    if (id === null || id === undefined) {
      return '—';
    }

    return this.lookups()[key]?.get(id) ?? `#${id}`;
  }

  protected subjectNames(csv: string | null): string {
    if (!csv) return '—';

    const map = this.lookups()[MASTER_KEYS.subject];

    return csv
      .split(',')
      .map((part) => map?.get(Number(part.trim())) ?? `#${part.trim()}`)
      .join(', ');
  }

  protected experience(months: number | null): string {
    if (months === null || months === undefined) return '—';

    const years = Math.floor(months / 12);
    const rest = months % 12;

    if (years === 0) return `${rest} month${rest === 1 ? '' : 's'}`;
    if (rest === 0) return `${years} year${years === 1 ? '' : 's'}`;

    return `${years}y ${rest}m`;
  }

  protected statusTone(statusId: number | undefined): string {
    switch (statusId) {
      case APPROVAL_STATUS.approved:
        return 'success';
      case APPROVAL_STATUS.rejected:
        return 'danger';
      case APPROVAL_STATUS.resubmitRequired:
        return 'warning';
      default:
        return 'neutral';
    }
  }

  // ---- documents ----------------------------------------------------------
  protected selectDocument(document: RequestDocument): void {
    this.selectedDocumentId.set(document.documentId);
  }

  protected verifyDocument(document: RequestDocument): void {
    this.acting.set(true);

    this.documents.verify(document.documentId, { isVerified: true }).subscribe({
      next: () => {
        this.toast.success(`${document.documentTypeName} verified.`);
        this.acting.set(false);
        this.load();
      },
      error: () => this.acting.set(false),
    });
  }

  // ---- the reason dialog --------------------------------------------------
  protected openDialog(dialog: Dialog): void {
    this.dialogReasonId.set('');
    this.dialogRemarks.set('');
    this.dialogError.set('');
    this.dialog.set(dialog);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
  }

  protected submitDialog(): void {
    const dialog = this.dialog();
    if (!dialog) return;

    const reasonId = this.dialogReasonId();
    const remarks = this.dialogRemarks().trim();

    if (reasonId === '') {
      this.dialogError.set('Pick the closest reason — it is what the school sees first.');
      return;
    }

    if (this.remarksRequired() && !remarks) {
      this.dialogError.set(
        'You picked "Other", so the note is the only thing telling them what to fix.',
      );
      return;
    }

    this.dialogError.set('');

    if (dialog.kind === 'reject-document') {
      this.acting.set(true);

      this.documents
        .verify(dialog.document.documentId, {
          isVerified: false,
          rejectionReasonId: Number(reasonId),
          remarks: remarks || null,
        })
        .subscribe({
          next: () => {
            this.toast.success(`${dialog.document.documentTypeName} rejected.`);
            this.acting.set(false);
            this.closeDialog();
            this.load();
          },
          error: () => this.acting.set(false),
        });

      return;
    }

    this.runAction(
      dialog.kind === 'reject-request' ? ACTION_TYPE.reject : ACTION_TYPE.requestResubmit,
      Number(reasonId),
      remarks || null,
    );
  }

  // ---- request-level actions ----------------------------------------------
  protected async approve(): Promise<void> {
    const header = this.header();
    if (!header) return;

    const outstanding = this.unverifiedMandatory();

    const confirmed = await this.confirm.ask({
      title: `Approve ${header.requestNo}?`,
      message: this.isTeacher()
        ? `This records your decision on ${header.entityName ?? 'this teacher'}. It cannot be undone.`
        : `${header.entityName ?? 'This school'} will be activated and able to sign in. ` +
          'This cannot be undone.' +
          (outstanding > 0
            ? ` ${outstanding} mandatory document${outstanding === 1 ? ' has' : 's have'} not been verified yet.`
            : ''),
      confirmText: 'Approve',
    });

    if (confirmed) {
      this.runAction(ACTION_TYPE.approve, null, null);
    }
  }

  private runAction(actionTypeId: number, rejectionReasonId: number | null, remarks: string | null): void {
    const header = this.header();
    if (!header) return;

    this.acting.set(true);
    this.notice.set(null);

    this.approvals
      .action(header.requestId, {
        actionTypeId,

        // 🔴 The RowVersion this screen was rendered from. If somebody else has
        // acted since, the server refuses rather than letting the later click
        // silently overwrite the earlier decision.
        rowVersion: header.rowVersion,
        rejectionReasonId,
        remarks,
      })
      .subscribe({
        next: (result) => {
          this.acting.set(false);
          this.closeDialog();
          this.applyOutcome(result, header.requestNo, header.requestTypeId);
          this.load();
        },
        error: (error: unknown) => {
          this.acting.set(false);
          this.handleActionError(error);
        },
      });
  }

  protected retryOrchestration(): void {
    const header = this.header();
    if (!header) return;

    this.acting.set(true);

    this.approvals.retryOrchestration(header.requestId).subscribe({
      next: (result) => {
        this.acting.set(false);
        this.applyOutcome(result, header.requestNo, header.requestTypeId);
        this.load();
      },
      error: () => this.acting.set(false),
    });
  }

  /**
   * 🔴 The only interpretation of an action result on this screen.
   *
   * A clean success is a toast — it is over, and it does not need the room. A
   * partial completion is a banner that stays, because it needs somebody to do
   * something about it.
   */
  private applyOutcome(result: ProcessActionResult, requestNo: string, requestTypeId: number): void {
    const notice = describeOutcome(result, requestNo, requestTypeId);

    if (notice.kind === 'done') {
      this.toast.success(notice.message);
      this.notice.set(null);
      return;
    }

    this.notice.set(notice);
  }

  /**
   * Someone else got here first.
   *
   * The server refused because the RowVersion moved, so the screen is out of
   * date — reload it and say what happened in a sentence. Never retry with the
   * new version behind the scenes: the decision this admin was about to make
   * was based on what they could see, and what they could see has changed.
   */
  private handleActionError(error: unknown): void {
    const code =
      error instanceof HttpErrorResponse ? (error.error?.code as string | undefined) : undefined;

    if (code === ERROR_CODES.concurrencyConflict) {
      this.notice.set({
        kind: 'partial',
        title: 'Somebody else acted on this first',
        message:
          'This request changed while you had it open, so nothing you did was applied. ' +
          'It has been reloaded with the current decision — check it before doing anything else.',
        canRetry: false,
      });

      this.closeDialog();
      this.load();
    }

    // Everything else has already been reported by the error interceptor.
  }

  protected readonly masterKeys = MASTER_KEYS;
}
