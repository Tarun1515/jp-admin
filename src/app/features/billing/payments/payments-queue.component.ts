import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UiBadgeComponent } from 'jp-shared/ui';
import {
  PaymentDetail,
  PaymentService,
  PendingPayment,
  VerifyPaymentResult,
} from '../../../core/payment.service';

/**
 * The payments queue, and the form that confirms one. Phase 6.5B.
 *
 * ----------------------------------------------------------------------------
 * A WORK QUEUE, NOT A REPORT
 * ----------------------------------------------------------------------------
 * The person here has a bank statement open beside the screen. Everything
 * follows from that: oldest first (decided in SQL), the expected amount beside
 * the reference the account quoted, and the form pre-filled with what the plan
 * costs so the common case is one click.
 *
 * ⚠️ One screen rather than a list and a detail route. A payment carries six
 * fields and the decision is made with the statement in hand — sending somebody
 * to a second page to type a UTR would add a navigation to every confirmation
 * for no information gained.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE AMOUNT IS WHAT ARRIVED, NOT WHAT WAS OWED (6.5-B)
 * ----------------------------------------------------------------------------
 * The field is editable and a short amount is RECORDED, never refused. A school
 * that transferred ₹4,900 against a ₹5,000 plan has paid ₹4,900, and a product
 * that refuses to record it has not prevented an underpayment — it has made the
 * real state of the world unrepresentable, and the correction then happens in
 * the database by hand with no trail.
 *
 * What IS required is a remark when the two differ. The server enforces that
 * and answers 400; this screen asks first so nobody meets the refusal.
 *
 * ----------------------------------------------------------------------------
 * 🔒 PAYMENT.VERIFY — AND THIS SCREEN DOES NOT CHECK IT
 * ----------------------------------------------------------------------------
 * The server checks it on every call, and the menu row is permission-gated so
 * the link is not offered to anybody else. Re-checking here would be a second
 * answer to a question the server already answers, and the two would drift
 * (the same reasoning AppConstants records for job permissions).
 */
@Component({
  selector: 'app-payments-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadgeComponent],
  templateUrl: './payments-queue.component.html',
  styleUrl: './payments-queue.component.scss',
})
export class PaymentsQueueComponent {
  private readonly payments = inject(PaymentService);

  protected readonly rows = this.payments.pending;
  protected readonly total = this.payments.total;
  protected readonly loading = this.payments.isLoading;
  protected readonly failed = this.payments.hasFailed;

  /** The payment whose form is open, fully loaded. */
  protected readonly open = signal<PaymentDetail | null>(null);

  protected readonly submitting = signal(false);

  /** The outcome of the last confirmation, kept so the screen can report it. */
  protected readonly outcome = signal<VerifyPaymentResult | null>(null);

  // ---- the form -------------------------------------------------------
  protected readonly amount = signal<number>(0);
  protected readonly modeId = signal<number>(2);
  protected readonly reference = signal('');
  protected readonly remarks = signal('');
  protected readonly paidOn = signal('');

  /**
   * ⚠️ ONLINE (1) is absent, deliberately: there is no gateway, so a payment
   * recorded as "Online" would be a lie about how the money came in. The ids
   * match m_mdm_payment_modes.
   */
  protected readonly modes = [
    { id: 2, label: 'Bank transfer' },
    { id: 3, label: 'Cheque' },
    { id: 4, label: 'Cash' },
  ];

  /**
   * 🔴 The live difference, recomputed as the admin types.
   *
   * ⚠️ Positive = short, negative = overpaid — the SAME direction the server
   * computes for the queue's `shortBy`. Two screens describing one difference
   * in opposite directions is the bug a bill dispute finds.
   */
  protected readonly difference = computed(() => {
    const payment = this.open();
    if (!payment || payment.priceQuoted === null) return 0;

    return Number((payment.priceQuoted - this.amount()).toFixed(2));
  });

  protected readonly differs = computed(() => this.difference() !== 0);

  /**
   * 🔴 The rule the server enforces, mirrored so the admin is asked before
   * being refused — not instead of being refused.
   */
  protected readonly remarkMissing = computed(
    () => this.differs() && this.remarks().trim().length === 0,
  );

  constructor() {
    this.payments.loadPending();
  }

  protected start(row: PendingPayment): void {
    this.outcome.set(null);

    this.payments.get(row.paymentId).subscribe((detail) => {
      if (!detail) return;

      this.open.set(detail);

      /*
        Pre-filled with the EXPECTED amount, because the common case is that
        exactly that arrived. An empty field would make the common case the
        slowest one, and a zero would be a number nobody meant.
      */
      this.amount.set(detail.priceQuoted ?? detail.amount);
      this.modeId.set(detail.paymentModeId === 1 ? 2 : detail.paymentModeId);
      this.reference.set(detail.gatewayRefNo ?? '');
      this.remarks.set(detail.remarks ?? '');
      this.paidOn.set('');
    });
  }

  protected cancel(): void {
    this.open.set(null);
  }

  protected confirm(): void {
    const payment = this.open();
    if (!payment || this.submitting() || this.remarkMissing()) return;

    this.submitting.set(true);

    this.payments
      .verify(payment.paymentId, {
        amount: this.amount(),
        paymentModeId: this.modeId(),
        referenceNo: this.reference().trim() || null,
        remarks: this.remarks().trim() || null,

        /*
          ⚠️ A date-only input, sent as the start of that day.
          `<input type="date">` gives `2026-10-11`, and the TimeSpan-style
          surprise 6C-2 hit with `type="time"` is the same family of bug — a
          binder that wants a full instant and silently refuses a partial one.
          Empty means "now", which the server decides.
        */
        paidOn: this.paidOn() ? `${this.paidOn()}T00:00:00` : null,
      })
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.outcome.set(result);

          /*
            🔴 The form stays OPEN when activation did not complete.

            The money is recorded and the plan is not active — and the recovery
            is submitting this same form again, because both halves are
            idempotent (6.5-A). Closing the form would hide the one action that
            fixes it.
          */
          if (result.activationCompleted) {
            this.open.set(null);
          }
        },
        error: () => {
          this.submitting.set(false);

          /*
            ⚠️ No toast here: the interceptor already shows the server's
            message, which carries the real reason — a missing remark, or a
            payment somebody else confirmed a moment ago.
          */
        },
      });
  }

  protected setAmount(value: string): void {
    const n = Number(value);
    this.amount.set(Number.isFinite(n) ? n : 0);
  }

  protected setMode(value: string): void {
    this.modeId.set(Number(value));
  }

  /** 2 = School, 3 = Teacher. Branch on the id, never on a name (2.47). */
  protected accountKind(row: PendingPayment): string {
    return row.userTypeId === 3 ? 'Teacher' : 'School';
  }

  /**
   * The day, in IST.
   *
   * ⚠️ Storage is UTC and the rules are IST (2.28). The zone is named, so an
   * administrator abroad reads the same date off the same row as one in Mumbai.
   */
  protected day(value: string | null): string {
    if (!value) return '—';

    const at = new Date(value.endsWith('Z') ? value : `${value}Z`);

    return at.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  }

  protected money(value: number | null): string {
    if (value === null) return '—';

    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  /**
   * 🔴 How a difference reads in words, because a signed number does not.
   *
   * "₹100 short" and "₹100 overpaid" are the two things an admin needs to tell
   * apart at a glance, and a bare "-100" invites exactly the wrong reading.
   */
  protected differenceLabel(): string {
    const d = this.difference();

    if (d === 0) return 'Matches the plan price';

    return d > 0 ? `${this.money(d)} short` : `${this.money(Math.abs(d))} overpaid`;
  }
}
