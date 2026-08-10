import { ProcessActionResult, REQUEST_TYPE } from './approval.models';

/**
 * What kind of thing just happened.
 *
 *   `done`        everything worked. Say so and move on.
 *   `partial`     🔴 the approval committed and the work after it did not.
 *                 Somebody is now Active with nothing behind them.
 *   `pending`     the request advanced a level and is not finished, so there
 *                 was nothing to orchestrate.
 *   `not-yet`     the decision is recorded and the effect is a Phase 3 feature.
 *                 Not a failure, and must not be dressed as one.
 */
export type OutcomeKind = 'done' | 'partial' | 'pending' | 'not-yet';

export interface OutcomeNotice {
  kind: OutcomeKind;
  title: string;
  message: string;

  /** Whether to offer the retry. Only ever true for `partial`. */
  canRetry: boolean;
}

/*==============================================================================
  🔴 THE ONE PLACE THAT READS orchestrationCompleted.

  Every action screen goes through here, so there is no second interpretation
  to drift. The rules, in the order they are checked:

  1. NOT COMPLETED YET — a multi-level request that advanced a level has not
     finished, so nothing was orchestrated and nothing failed. The server sets
     orchestrationCompleted = true for this case precisely so it does not look
     like a failure, but saying "approved" would be wrong: the next approver
     still has it.

  2. TEACHER VERIFICATION — comes back with orchestrationCompleted = false BY
     DESIGN. A teacher account is Active from signup and verification is a
     badge on a profile that does not exist until Phase 3 (2.9, 2.48), so the
     branch provisions nothing and refuses to claim it did.

     This must NOT be shown as a system error. Nothing is broken, nothing needs
     retrying, and an admin who sees a red failure here will stop approving
     teachers and file a bug.

     Branching on requestTypeId rather than on the message: the id is a
     contract value (2.47), the message is display text.

  3. ANYTHING ELSE FALSE — the real partial completion. Name the request, say
     plainly what is and is not true, and offer the retry.

  ⚠️ The success path is LAST on purpose. Reaching it by default — writing
  `if (ok) success() else …` — is how the failure ends up behind a toast that
  says "Approved".
==============================================================================*/
export function describeOutcome(
  result: ProcessActionResult,
  requestNo: string,
  requestTypeId: number,
): OutcomeNotice {
  if (!result.isCompleted) {
    return {
      kind: 'pending',
      title: 'Passed to the next level',
      message:
        `${requestNo} has moved to approval level ${result.currentApprovalLevel ?? '—'}. ` +
        'It stays in the queue until that level acts on it.',
      canRetry: false,
    };
  }

  if (!result.orchestrationCompleted && requestTypeId === REQUEST_TYPE.teacherVerification) {
    return {
      kind: 'not-yet',
      title: 'Decision recorded',
      message:
        `Your decision on ${requestNo} is saved and sits in the action trail. ` +
        'The verified badge itself will appear on the teacher profile once teacher ' +
        'profiles are built — nothing further is needed from you here.',
      canRetry: false,
    };
  }

  if (!result.orchestrationCompleted) {
    return {
      kind: 'partial',
      title: 'Approved — but the account is not usable yet',
      message:
        `${requestNo} is approved and that decision is final. What did not finish is the ` +
        'work that follows it: ' +
        (result.orchestrationError ?? 'the school record could not be created.') +
        ' Until this is retried, the school can sign in and will find an empty workspace.',
      canRetry: true,
    };
  }

  return {
    kind: 'done',
    title: result.message || 'Done',
    message: result.message || 'The request has been actioned.',
    canRetry: false,
  };
}
