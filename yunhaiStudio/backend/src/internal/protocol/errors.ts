// 对应 backend/internal/protocol/errors.go

export class UnavailableError extends Error {
  constructor(
    readonly protocol: string,
    readonly reason: string,
  ) {
    super(reason ? `protocol ${protocol} is unavailable: ${reason}` : `protocol ${protocol} is unavailable`);
    this.name = "UnavailableError";
  }
}

export function unavailable(metadata: { id: string; unavailableReason?: string }): UnavailableError {
  return new UnavailableError(metadata.id, metadata.unavailableReason ?? "");
}
