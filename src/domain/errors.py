class DomainError(Exception):
    code = "DOMAIN_ERROR"


class InvalidRequest(DomainError):
    code = "INVALID_REQUEST"


class NotFound(DomainError):
    code = "NOT_FOUND"


class Conflict(DomainError):
    code = "CONFLICT"
