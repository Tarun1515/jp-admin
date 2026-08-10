/*==============================================================================
  Types for the approval engine, mirroring JP.Domain.Approvals.

  Kept in step with the C# records by hand. When one changes, the other changes
  in the same commit — a field that exists on one side only is a runtime
  `undefined` that TypeScript will happily believe in.
==============================================================================*/

/** m_mdm_request_types. Contract values (decision 2.47). */
export const REQUEST_TYPE = {
  schoolRegistration: 1,
  teacherVerification: 2,
  branchAdd: 3,
  offerApproval: 4,
} as const;

/** m_mdm_approval_status. */
export const APPROVAL_STATUS = {
  pending: 1,
  rejected: 2,
  approved: 3,
  resubmitRequired: 4,
  draft: 8,
} as const;

/** m_mdm_action_types. */
export const ACTION_TYPE = {
  approve: 1,
  reject: 2,
  requestResubmit: 3,
  submit: 4,
  resubmit: 5,
} as const;

export interface ApprovalListItem {
  requestId: number;
  requestUid: string;
  requestNo: string;
  requestTypeId: number;
  requestTypeCode: string;
  requestTypeName: string;
  statusId: number;
  statusCode: string;
  statusName: string;
  currentApprovalLevel: number;
  entityUid: string;
  organizationUid: string | null;
  requestorUserId: number;
  approverUserId: number | null;
  submittedOn: string;
  completedOn: string | null;

  /** Optimistic concurrency. Sent back on every action. */
  rowVersion: number;

  entityName: string | null;

  /**
   * Computed in SQL, deliberately.
   *
   * The queue, the dashboard and any future export all read the same number
   * from the same place — a browser clock that is a day out would otherwise
   * quietly disagree with the server about which request is oldest.
   */
  waitingDays: number;
}

export interface SchoolRegistrationDetail {
  requestId: number;
  schoolName: string;
  schoolTypeId: number | null;
  boardId: number | null;
  affiliationNumber: string | null;
  registrationNo: string | null;
  logoPath: string | null;
  groupType: number | null;
  establishedYear: number | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityId: number | null;
  districtId: number | null;
  stateId: number | null;
  pincode: string | null;
  principalName: string | null;
  principalMobile: string | null;
  hrContactName: string | null;
  hrContactMobile: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
  website: string | null;
  aboutSchool: string | null;
}

export interface TeacherRegistrationDetail {
  requestId: number;
  fullName: string;
  dob: string | null;
  genderId: number | null;
  qualificationId: number | null;
  totalExperienceMonths: number | null;
  currentCityId: number | null;
  currentStateId: number | null;
  currentSchool: string | null;

  /** Comma-separated ids, aggregated in SQL. */
  subjectIds: string | null;
}

export interface RequestDocument {
  documentId: number;
  requestId: number;
  documentTypeId: number;
  documentTypeCode: string;
  documentTypeName: string;
  isMandatory: boolean;
  fileName: string;
  fileSizeKb: number;
  mimeType: string;
  version: number;
  isVerified: boolean;
  verifiedByUserId: number | null;
  verifiedOn: string | null;
  rejectionReasonId: number | null;
  rejectionReasonName: string | null;
  remarks: string | null;
  createdOn: string;
}

export interface RequestAction {
  approvalId: number;
  requestId: number;
  levelNumber: number;
  actionTypeId: number;
  actionTypeCode: string;
  actionTypeName: string;
  actionByUserId: number;

  /**
   * Set on a rejection or a resubmission request, null on an approve.
   *
   * Structured alongside the remarks rather than instead of them: the remarks
   * are what the applicant reads, this is what anybody counting rejection
   * causes reads, and free text is not countable.
   */
  rejectionReasonId: number | null;
  rejectionReasonName: string | null;

  remarks: string | null;
  actionOn: string;
  ipAddress: string | null;
}

export interface RequestPayment {
  paymentId: number;
  requestId: number;
  planId: number | null;
  amount: number;
  paymentModeId: number;
  paymentModeName: string;
  gatewayRefNo: string | null;
  paymentStatusId: number;
  paymentStatusName: string;
  paidOn: string | null;
  verifiedByUserId: number | null;
}

export interface ApprovalDetail {
  header: ApprovalListItem;
  schoolDetail: SchoolRegistrationDetail | null;
  teacherDetail: TeacherRegistrationDetail | null;
  documents: RequestDocument[];
  trail: RequestAction[];
  payments: RequestPayment[];
}

export interface ApprovalFilter {
  requestTypeId?: number;
  statusId?: number;
  assignedToUserId?: number;

  /** IST calendar dates, `yyyy-MM-dd`. Converted to a UTC range in SQL (2.28). */
  fromDate?: string;
  toDate?: string;

  search?: string;

  /**
   * One of the five columns the procedure knows how to sort by. Anything else
   * falls back to the queue's own order rather than erroring — a sort is not
   * worth failing a page load over.
   */
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';

  pageNumber?: number;
  pageSize?: number;
}

export interface ProcessActionBody {
  actionTypeId: number;

  /** Required. Two admins with the same request open must not both succeed. */
  rowVersion: number;

  remarks?: string | null;
  rejectionReasonId?: number | null;
}

/**
 * What came back from an approve, a reject, or a retry.
 *
 * 🔴 `orchestrationCompleted` is the field that matters, NOT the HTTP status.
 *
 * A 200 means the approval committed in jp_mdm. The work that follows it lives
 * in two other databases with two other transactions (decision 2.2), and any
 * of it can fail afterwards. When it does, this comes back 200 — because the
 * approval genuinely happened and cannot be un-happened — with
 * `orchestrationCompleted = false` and something to show the admin.
 *
 * Treating 200 as success here is precisely the bug the whole partial-failure
 * machinery exists to prevent.
 */
export interface ProcessActionResult {
  requestId: number;
  newStatusId: number;
  currentApprovalLevel: number | null;
  isCompleted: boolean;
  orchestrationCompleted: boolean;
  orchestrationError: string | null;
  message: string;
}

/**
 * An approval that completed while the work after it did not.
 *
 * The account may be Active with nothing behind it: the person can sign in and
 * lands on an empty workspace.
 */
export interface OrphanedApproval {
  requestId: number;
  requestUid: string;
  requestNo: string;
  requestTypeId: number;
  requestTypeName: string;
  organizationUid: string | null;
  requestorUserId: number;
  entityName: string | null;
  completedOn: string;
  hoursSinceCompleted: number;

  /** Composed server-side, so every surface says the same thing. */
  reason: string;
}

export interface PendingCount {
  requestTypeId: number;
  requestTypeCode: string;
  requestTypeName: string;
  pendingCount: number;
  oldestWaitingDays: number;
}

export interface VerifyDocumentBody {
  isVerified: boolean;
  rejectionReasonId?: number | null;
  remarks?: string | null;
}
