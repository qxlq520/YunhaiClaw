export const codeOk = 0;

export const codeInvalidArgument = 400;
export const codeUnauthorized = 401;
export const codeForbidden = 403;
export const codeNotFound = 404;
export const codeConflict = 409;
export const codeTooManyRequests = 429;
export const codeInternal = 500;
export const codeBadGateway = 502;
export const codeUnavailable = 503;
export const codeTimeout = 504;

export const codeQuotaExceeded = 40301;
export const codeStorageReadOnly = 40302;
export const codeIdempotencyConflict = 40901;
export const codeCanvasResourcesMissing = 40902;
export const codeRateLimited = 42901;
export const codeAccountNotRegistered = 40401;

export type ErrorReason =
  | "invalid_argument"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "project_name_conflict"
  | "skill_version_conflict"
  | "canvas_history_resources_missing"
  | "failed_precondition"
  | "quota_exceeded"
  | "storage_capacity_exceeded"
  | "storage_read_only"
  | "drama_budget_exhausted"
  | "drama_segment_changed"
  | "drama_episode_confirm_required"
  | "agent_interjection_run_finished"
  | "agent_interjection_already_delivered"
  | "agent_run_state_busy"
  | "account_not_registered"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "internal"
  | "bad_gateway"
  | "upstream_dns_failed";

export function reasonForStatus(status: number): ErrorReason {
  switch (status) {
    case codeInvalidArgument:
      return "invalid_argument";
    case codeUnauthorized:
      return "unauthorized";
    case codeForbidden:
      return "forbidden";
    case codeNotFound:
      return "not_found";
    case codeConflict:
      return "conflict";
    case codeTooManyRequests:
      return "rate_limited";
    case codeBadGateway:
      return "bad_gateway";
    case codeUnavailable:
      return "unavailable";
    case codeTimeout:
      return "timeout";
    default:
      return status >= 500 ? "internal" : "invalid_argument";
  }
}
