"""Privacy-conscious identifiers for temporary realtime diagnostics."""

import hashlib
import hmac
import secrets
from uuid import UUID


_DIAGNOSTIC_KEY = secrets.token_bytes(32)


def diagnostic_id(value: str) -> str:
    """Return a process-local pseudonym that cannot reveal short room codes."""
    digest = hmac.new(
        _DIAGNOSTIC_KEY,
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest[:12]


def diagnostic_request_id(value: str) -> str:
    """Keep generated UUIDs joinable across logs; pseudonymize other input."""
    try:
        parsed = UUID(value)
    except (AttributeError, ValueError):
        return diagnostic_id(value)
    if parsed.version == 4 and str(parsed) == value.lower():
        return str(parsed)
    return diagnostic_id(value)
