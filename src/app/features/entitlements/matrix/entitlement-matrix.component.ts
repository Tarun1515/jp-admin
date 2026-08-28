import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToastService } from 'jp-shared/core';

import {
  EntitlementMatrix,
  EntitlementService,
  Feature,
  GATING_MODE,
  PlanFeature,
  PlanSummary,
} from '../../../core/entitlement.service';

/** What one cell of the grid is. Unmapped is a state, not an empty value. */
type CellState = 'unmapped' | 'included' | 'excluded' | 'metered' | 'free';

interface Cell {
  plan: PlanSummary;
  feature: Feature;
  mapping: PlanFeature | null;
  state: CellState;
  /** Rendered text. Never blank — see the component docs. */
  label: string;
}

interface Row {
  feature: Feature;
  cells: Cell[];
}

/**
 * The plan × feature matrix.
 *
 * ----------------------------------------------------------------------------
 * 🔴 AN UNMAPPED CELL IS RENDERED AS "UNMAPPED", NEVER AS BLANK
 * ----------------------------------------------------------------------------
 * The engine refuses on a missing mapping: absence of a row is absence of a
 * decision, and reading "nobody said anything" as "yes" would grant capability
 * nobody sold.
 *
 * A blank cell reads as either "zero" or "nothing to see here", and both are
 * wrong — it means DENIED. Every cell therefore carries a word. The screen and
 * the engine are looking at the same fact, spelled out in both.
 *
 * ⚠️ This is why adding a feature to the catalog grants it to nobody until it
 * is mapped. Correct, and slightly inconvenient — which is exactly why it has
 * to be visible here rather than inferred from an empty box.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE KILL SWITCH IS A SEPARATE, VISIBLY DIFFERENT CONTROL
 * ----------------------------------------------------------------------------
 * It is not a fourth entry in the mode dropdown, because a mode-based
 * "disabled" would overwrite the mode it replaced — and restoring it would then
 * depend on somebody remembering that JOB_POST used to be metered, at the
 * moment they are already handling an incident.
 *
 * So: a dropdown for "how is access decided", and a switch for "does this
 * feature exist right now". Two questions, two controls. A switched-off row is
 * struck through and tinted, so the state is legible from across the room.
 *
 * ----------------------------------------------------------------------------
 * DISABLED CONTROLS — 2.62's DISTINCTION
 * ----------------------------------------------------------------------------
 * A cell that CANNOT be mapped (a school feature against a teacher plan) gets
 * no control at all and says why. That is "not allowed", and a greyed-out
 * button there would read as broken.
 *
 * Nothing on this screen is "not yet", so nothing here is disabled-with-a-date.
 */
@Component({
  selector: 'app-entitlement-matrix',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './entitlement-matrix.component.html',
  styleUrl: './entitlement-matrix.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntitlementMatrixComponent {
  private readonly service = inject(EntitlementService);
  private readonly toast = inject(ToastService);

  protected readonly matrix = signal<EntitlementMatrix | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal<string | null>(null);

  /** Which user type's plans are on screen. Schools first — they buy things. */
  protected readonly userTypeId = signal(2);

  protected readonly MODE = GATING_MODE;

  constructor() {
    this.load();
  }

  protected readonly plans = computed(() =>
    (this.matrix()?.plans ?? []).filter((p) => p.userTypeId === this.userTypeId()),
  );

  protected readonly features = computed(() =>
    (this.matrix()?.features ?? []).filter((f) => f.appliesToUserTypeId === this.userTypeId()),
  );

  protected readonly gatingModes = computed(() => this.matrix()?.gatingModes ?? []);

  /**
   * The grid, composed here from the three lists rather than on the server.
   *
   * ⚠️ Composing it in the browser is what keeps "unmapped" honest: the server
   * sends only the mappings that EXIST, so a cell with no mapping is a cell the
   * server never claimed anything about.
   */
  protected readonly rows = computed<Row[]>(() => {
    const mappings = this.matrix()?.mappings ?? [];
    const plans = this.plans();

    return this.features().map((feature) => ({
      feature,
      cells: plans.map((plan) => this.toCell(plan, feature, mappings)),
    }));
  });

  /** How many features are switched off right now — the incident banner. */
  protected readonly disabledCount = computed(
    () => (this.matrix()?.features ?? []).filter((f) => !f.isActive).length,
  );

  private toCell(plan: PlanSummary, feature: Feature, mappings: PlanFeature[]): Cell {
    const mapping =
      mappings.find((m) => m.planId === plan.planId && m.featureId === feature.featureId) ?? null;

    /*
      A FREE feature never reads a mapping — the mode IS the grant. Printing
      "unmapped" there would be true and misleading in the same breath, because
      it implies a refusal that will not happen.
    */
    if (feature.gatingModeId === GATING_MODE.free) {
      return { plan, feature, mapping, state: 'free', label: 'Free for all plans' };
    }

    if (!mapping) {
      return { plan, feature, mapping, state: 'unmapped', label: 'Unmapped — denied' };
    }

    if (feature.gatingModeId === GATING_MODE.boolean) {
      return mapping.isIncluded
        ? { plan, feature, mapping, state: 'included', label: 'Included' }
        : { plan, feature, mapping, state: 'excluded', label: 'Not included' };
    }

    const quota = mapping.quotaPerPeriod;

    return {
      plan,
      feature,
      mapping,
      state: 'metered',
      // Null and 0 are different facts and must not print the same.
      label: quota === null ? 'Unlimited' : `${quota} per month`,
    };
  }

  /** A school feature cannot be mapped to a teacher plan, or the reverse. */
  protected canMap(cell: Cell): boolean {
    return cell.plan.userTypeId === cell.feature.appliesToUserTypeId;
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.service.getMatrix().subscribe({
      next: (m) => {
        this.matrix.set(m);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
        this.toast.error('Could not load plans and features.');
      },
    });
  }

  protected onModeChange(feature: Feature, value: string): void {
    this.saveGating(feature, Number(value), feature.isActive);
  }

  protected onKillSwitch(feature: Feature, isActive: boolean): void {
    this.saveGating(feature, feature.gatingModeId, isActive);
  }

  private saveGating(feature: Feature, gatingModeId: number, isActive: boolean): void {
    this.saving.set(`f${feature.featureId}`);

    this.service.saveGating(feature.featureId, gatingModeId, isActive).subscribe({
      next: () => {
        this.saving.set(null);

        /*
          🔴 Reload rather than patching the signal in place.

          This screen is the lever, and after pulling it the operator has to see
          what the DATABASE says — not what this component believes it just did.
          The flip is live on the consume path the moment the save returns, so
          a locally-patched value would be the one place where the screen could
          disagree with the engine.
        */
        this.load();
        this.toast.success(isActive ? 'Saved.' : `${feature.name} is now switched off.`);
      },
      error: () => {
        this.saving.set(null);
        this.load();
        this.toast.error('That change was not saved.');
      },
    });
  }

  protected onIncludedChange(cell: Cell, isIncluded: boolean): void {
    this.save(cell, 'MAP', isIncluded, cell.mapping?.quotaPerPeriod ?? null);
  }

  protected onQuotaChange(cell: Cell, raw: string): void {
    const trimmed = raw.trim();

    // Empty means unlimited. It is NOT zero, and the engine does not treat it
    // as zero — so the control must not either.
    const quota = trimmed === '' ? null : Number(trimmed);

    if (quota !== null && (!Number.isInteger(quota) || quota < 0)) {
      this.toast.error('A quota must be a whole number, or empty for unlimited.');
      this.load();

      return;
    }

    this.save(cell, 'MAP', cell.mapping?.isIncluded ?? false, quota);
  }

  protected onMap(cell: Cell): void {
    this.save(cell, 'MAP', cell.feature.gatingModeId === GATING_MODE.boolean, null);
  }

  protected onUnmap(cell: Cell): void {
    this.save(cell, 'UNMAP', false, null);
  }

  private save(
    cell: Cell,
    action: 'MAP' | 'UNMAP',
    isIncluded: boolean,
    quotaPerPeriod: number | null,
  ): void {
    this.saving.set(this.cellKey(cell));

    this.service
      .savePlanFeature({
        planId: cell.plan.planId,
        featureId: cell.feature.featureId,
        action,
        isIncluded,
        quotaPerPeriod,
      })
      .subscribe({
        next: () => {
          this.saving.set(null);
          this.load();
          this.toast.success(action === 'UNMAP' ? 'Unmapped — this plan is now denied.' : 'Saved.');
        },
        error: () => {
          this.saving.set(null);
          this.load();
          this.toast.error('That change was not saved.');
        },
      });
  }

  protected isSaving(key: string): boolean {
    return this.saving() === key;
  }

  protected cellKey(cell: Cell): string {
    return `p${cell.plan.planId}f${cell.feature.featureId}`;
  }

  protected featureKey(feature: Feature): string {
    return `f${feature.featureId}`;
  }
}
