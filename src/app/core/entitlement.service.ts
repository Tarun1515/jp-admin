import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { Observable, map } from 'rxjs';

/**
 * 🔴 THE PROHIBITION THIS ENGINE CARRIES EVERYWHERE (2.56 — LOCKED)
 *
 * The entitlement engine and contact unlock never reference each other, in
 * either direction. A subscription buys the school's CAPABILITY — whether it
 * may search at all, how many invitations it may send. It never buys a
 * teacher's phone number or email; contact opens on the teacher's own consent.
 *
 * Nothing in this file may carry or consult a contact detail.
 */

/** 1 = FREE, 2 = BOOLEAN, 3 = METERED. There is no 4. */
export const GATING_MODE = {
  free: 1,
  boolean: 2,
  metered: 3,
} as const;

export interface PlanSummary {
  planId: number;
  planCode: string;
  name: string;
  /** 2 = School, 3 = Teacher. */
  userTypeId: number;
  price: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface Feature {
  featureId: number;
  featureCode: string;
  name: string;
  description: string | null;
  gatingModeId: number;
  gatingModeCode: string;
  gatingModeName: string;
  appliesToUserTypeId: number;
  displayOrder: number;
  /**
   * 🔴 THE KILL SWITCH — not a gating mode.
   *
   * Orthogonal to `gatingModeId` so that switching a feature off does not
   * destroy the record of how it was gated. A mode-based "disabled" would
   * overwrite METERED, and restoring it would depend on somebody remembering,
   * mid-incident.
   */
  isActive: boolean;
}

export interface PlanFeature {
  planFeatureId: number;
  planId: number;
  featureId: number;
  isIncluded: boolean;
  /** Null = unlimited within the plan. NOT the same as 0. */
  quotaPerPeriod: number | null;
  isActive: boolean;
}

export interface GatingMode {
  gatingModeId: number;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
}

/**
 * ⚠️ Four lists, not a pre-joined grid.
 *
 * A grid would have to invent a row for every plan × feature pair and mark most
 * of them unmapped — and then nothing could tell an invented row from a real
 * one carrying zeros. Sent this way, UNMAPPED stays what it actually is: the
 * absence of an entry in `mappings`. That is the same fact the engine refuses
 * on, so the screen and the engine agree by construction.
 */
export interface EntitlementMatrix {
  plans: PlanSummary[];
  features: Feature[];
  mappings: PlanFeature[];
  gatingModes: GatingMode[];
}

interface ApiEnvelope<T> {
  status: number;
  code: string | null;
  message: string;
  data: T;
}

/**
 * The plan × feature matrix, over HTTP.
 *
 * 🔴 NO CACHING HERE, AND THAT IS NOT AN OVERSIGHT.
 *
 * This screen is the operator's lever. Every read must show what the database
 * says right now, because the next thing the person does is act on it during an
 * incident. The server does not cache these reads either — see
 * MONETIZATION_DESIGN.md, "Gating reads never come from the master cache".
 *
 * ⚠️ Every endpoint here requires SETTINGS.MANAGE, held by SUPER_ADMIN alone.
 * The permission is checked on the server; hiding the menu row is presentation,
 * never protection.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/entitlements`;

  getMatrix(): Observable<EntitlementMatrix> {
    return this.http
      .get<ApiEnvelope<EntitlementMatrix>>(`${this.baseUrl}/matrix`)
      .pipe(map((r) => r.data));
  }

  /**
   * Set a feature's mode and its kill switch.
   *
   * Both travel together because the screen holds both and an operator
   * experiences one edit — but they remain independent columns on the server.
   *
   * 🔴 There is nothing to invalidate afterwards. The next consume reads the
   * row, so the flip is live immediately.
   */
  saveGating(featureId: number, gatingModeId: number, isActive: boolean): Observable<void> {
    return this.http
      .put<ApiEnvelope<unknown>>(`${this.baseUrl}/features/${featureId}/gating`, {
        gatingModeId,
        isActive,
      })
      .pipe(map(() => undefined));
  }

  /**
   * Map a feature to a plan, or unmap it.
   *
   * ⚠️ UNMAP returns the cell to "no decision", and the engine refuses on that.
   * Removing a mapping removes access from that plan — the safe direction for a
   * screen edited by hand.
   */
  savePlanFeature(body: {
    planId: number;
    featureId: number;
    action: 'MAP' | 'UNMAP';
    isIncluded: boolean;
    quotaPerPeriod: number | null;
  }): Observable<void> {
    return this.http
      .put<ApiEnvelope<unknown>>(`${this.baseUrl}/plan-features`, body)
      .pipe(map(() => undefined));
  }
}
