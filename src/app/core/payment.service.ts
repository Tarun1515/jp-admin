import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

/**
 * 🔒 THE PROHIBITION THIS CARRIES, LIKE EVERY ENGINE AND BILLING OBJECT (2.56 — LOCKED)
 *
 * A verified payment buys the school's CAPABILITY — whether it may search at
 * all, how many invitations it may send. It never buys a teacher's phone number
 * or email: contact opens on the teacher's own consent, by exactly two paths,
 * and a payment is not a third one.
 *
 * Nothing in this file may carry or consult a contact detail, and the 2.56 grep
 * asserts that.
 */

/** One row of the queue, exactly as `GET /api/billing/payments/pending` returns it. */
export interface PendingPayment {
  paymentId: number;
  paymentUid: string;
  requestId: number;

  /** The reference the account quotes to support (2.46). */
  requestNo: string;
  entityUid: string;
  organizationUid: string | null;
  requestorUserId: number;
  submittedOn: string;
  planId: number;
  planCode: string;
  planName: string;

  /** 2 = School, 3 = Teacher. */
  userTypeId: number;
  durationDays: number | null;

  /** What is recorded — the expected amount until an admin replaces it. */
  amount: number;

  /** What the plan cost when the account agreed to it (2.7). */
  priceQuoted: number | null;
  paymentModeId: number;
  paymentModeName: string;
  gatewayRefNo: string | null;
  remarks: string | null;
  createdOn: string;

  /**
   * 🔴 Positive = short, negative = overpaid.
   *
   * Computed in SQL so the queue and the form cannot get the sign different
   * ways round (6.5-B). A bill dispute is the worst place to discover which
   * direction a screen chose.
   */
  shortBy: number;
  amountDiffers: boolean;
}

/** Everything the verify form needs, including what the payment already was. */
export interface PaymentDetail extends Omit<PendingPayment, 'requestorUserId'> {
  paymentStatusId: number;
  paymentStatusCode: string;
  paidOn: string | null;
  verifiedByUserId: number | null;
  requestStatusId: number;
  receiptNo: string | null;
  receiptIssuedOn: string | null;
}

/** What an admin types when money has arrived. */
export interface VerifyPaymentRequest {
  amount: number;
  paymentModeId: number;

  /** The UTR, the cheque number, the receipt book number. */
  referenceNo: string | null;

  /**
   * 🔴 REQUIRED when the amount differs from the quoted price (6.5-B).
   *
   * The server enforces it and will answer 400 VALIDATION_FAILED — this screen
   * asks for it first so nobody meets that refusal, but the server remains the
   * authority. A client-only rule is a rule the next client forgets.
   */
  remarks: string | null;

  /** When the money actually arrived, not when it was recorded. Null = now. */
  paidOn: string | null;
}

/**
 * The result of the whole seam: payment verified, subscription activated.
 */
export interface VerifyPaymentResult {
  verified: boolean;
  alreadyVerified: boolean;
  receiptNo: string | null;

  /**
   * 🔴 THE TRUTH ABOUT A HANDOFF THAT SPANS TWO DATABASES.
   *
   * Verification is in jp_mdm and activation in jp_app, with no distributed
   * transaction (2.2, 2.48). So the payment can be recorded while the plan is
   * not yet active, and the server says so rather than smoothing it over. The
   * payment is never rolled back — the money really did arrive.
   *
   * ⚠️ Recovery is submitting the SAME form again: both halves are idempotent.
   */
  activationCompleted: boolean;
  activationError: string | null;
  alreadyActivated: boolean;
  subscriptionId: number | null;
  planId: number | null;
  planName: string | null;
  endsOn: string | null;
  message: string;
}

/** One subscription an owner has held — the history panel on a detail screen. */
export interface SubscriptionHistoryRow {
  subscriptionId: number;
  planId: number;
  planName: string;
  startsOn: string;
  endsOn: string | null;
  statusId: number;
  isActive: boolean;

  /** From `fn_SubscriptionInForce` — never re-derived on the client. */
  inForce: boolean;
  sourcePaymentUid: string | null;
}

/**
 * Payments awaiting an administrator, and the act of confirming one.
 *
 * ----------------------------------------------------------------------------
 * 🔒 PAYMENT.VERIFY, AND ONLY SUPER_ADMIN HOLDS IT
 * ----------------------------------------------------------------------------
 * jp_sso's seed grants it to SUPER_ADMIN and to no school or teacher role, and
 * its build guard asserts the CLOSED SET of holders rather than merely checking
 * that SUPER_ADMIN is among them — a school verifying its own payment is the
 * entire attack.
 *
 * ⚠️ The server checks it on every call here. This service does not pre-check
 * and must not: a client-side gate that hides a button is presentation, and the
 * verification forces the negative with a school owner and a teacher.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THERE IS NO GATEWAY CALLBACK HERE EITHER
 * ----------------------------------------------------------------------------
 * 6.5 is manual-first. When a gateway arrives, its callback calls the SAME
 * server method this service calls (`VerifyAndActivateAsync`) — with its own
 * authentication in the API layer. Nothing in this file would change.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(JP_API_CONFIG);

  private readonly pendingSignal = signal<PendingPayment[]>([]);
  private readonly totalSignal = signal(0);
  private readonly loadingSignal = signal(false);

  /**
   * 🔴 A FAILED READ IS NOT AN EMPTY QUEUE.
   *
   * "No payments are waiting" and "we could not ask" are different statements,
   * and showing the first when the second is true is how a school's payment
   * sits unconfirmed for a week.
   */
  private readonly failedSignal = signal(false);

  readonly pending = this.pendingSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();
  readonly isLoading = this.loadingSignal.asReadonly();
  readonly hasFailed = this.failedSignal.asReadonly();

  loadPending(pageNumber = 1, pageSize = 25): void {
    this.loadingSignal.set(true);
    this.failedSignal.set(false);

    this.http
      .get<{ data: PendingPayment[]; totalRecords: number }>(
        `${this.api.appApiUrl}/billing/payments/pending`
          + `?pageNumber=${pageNumber}&pageSize=${pageSize}`,
      )
      .pipe(
        catchError(() => {
          this.failedSignal.set(true);
          return of({ data: [] as PendingPayment[], totalRecords: 0 });
        }),
      )
      .subscribe((response) => {
        this.pendingSignal.set(response.data ?? []);
        this.totalSignal.set(response.totalRecords ?? 0);
        this.loadingSignal.set(false);
      });
  }

  get(paymentId: number): Observable<PaymentDetail | null> {
    return this.http
      .get<{ data: PaymentDetail }>(`${this.api.appApiUrl}/billing/payments/${paymentId}`)
      .pipe(map((r) => r.data ?? null));
  }

  /**
   * 🔴 THE SEAM, from the screen's side: verify and activate in one call.
   *
   * The result carries `activationCompleted` separately from `verified`,
   * because they can genuinely differ — and the form shows both rather than
   * reporting one as the other.
   */
  verify(paymentId: number, request: VerifyPaymentRequest): Observable<VerifyPaymentResult> {
    return this.http
      .post<{ data: VerifyPaymentResult }>(
        `${this.api.appApiUrl}/billing/payments/${paymentId}/verify`,
        request,
      )
      .pipe(
        map((r) => r.data),

        // Reload, so a confirmed payment leaves the queue.
        tap(() => this.loadPending()),
      );
  }

  historyFor(ownerUid: string): Observable<SubscriptionHistoryRow[]> {
    return this.http
      .get<{ data: SubscriptionHistoryRow[] }>(
        `${this.api.appApiUrl}/billing/owners/${ownerUid}/history`,
      )
      .pipe(map((r) => r.data ?? []));
  }
}
