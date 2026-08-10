import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { ACTION_TYPE, RequestAction } from '../../../core/approval.models';

/**
 * The action trail as a timeline.
 *
 * A timeline rather than a table, because the only thing anybody wants from
 * this panel is "one thing after another, and what was said each time" — and a
 * table would promise columns that carry no meaning across rows.
 *
 * ⚠️ The trail is APPEND ONLY in the database. Nothing here offers to edit or
 * delete an entry, and nothing should: the one occasion this panel is read
 * carefully is when a decision is being questioned.
 *
 * Its own component partly because the school-side status screen (Phase 2F)
 * shows the same history to the applicant. If that turns out to need the exact
 * same markup, this belongs in jp-shared rather than being copied.
 */
@Component({
  selector: 'app-request-trail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  templateUrl: './request-trail.component.html',
  styleUrl: './request-trail.component.scss',
})
export class RequestTrailComponent {
  readonly entries = input<readonly RequestAction[]>([]);

  /** The dot's colour. Reinforces the word beside it; never the only carrier. */
  protected dot(actionTypeId: number): string {
    switch (actionTypeId) {
      case ACTION_TYPE.approve:
        return 'trail__dot--success';
      case ACTION_TYPE.reject:
        return 'trail__dot--danger';
      case ACTION_TYPE.requestResubmit:
        return 'trail__dot--warning';
      default:
        return 'trail__dot--neutral';
    }
  }
}
