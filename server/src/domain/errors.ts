export class DomainError extends Error {
  readonly code: string = "DOMAIN_ERROR";
}

export class InvalidRequest extends DomainError {
  override readonly code = "INVALID_REQUEST";
}

export class NotFound extends DomainError {
  override readonly code = "NOT_FOUND";
}

export class Conflict extends DomainError {
  override readonly code = "CONFLICT";
}
