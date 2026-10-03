"""Privacy-conscious identifiers for temporary realtime diagnostics."""

import hashlib
import hmac
import secrets


_DIAGNOSTIC_KEY = secrets.token_bytes(32)


def diagnostic_id(value: str) -> str:
    """Return a process-local pseudonym that cannot reveal short room codes."""
    digest = hmac.new(
        _DIAGNOSTIC_KEY,
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest[:12]
