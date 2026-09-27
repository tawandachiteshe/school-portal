"""Small crypto helpers: cookie hashing, AES-GCM for stored tokens, keyed hashes for IDs."""

import base64
import hashlib
import hmac
import os
import secrets
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


@lru_cache
def _key() -> bytes:
    s = get_settings()
    if s.session_encryption_key and s.session_encryption_key != "change-me":
        key = base64.b64decode(s.session_encryption_key)
        if len(key) != 32:
            raise ValueError("SESSION_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
        return key
    if s.is_prod:
        raise ValueError("SESSION_ENCRYPTION_KEY is required in production")
    return hashlib.sha256(s.secret_key.encode()).digest()


def encrypt(plaintext: str) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)


def decrypt(blob: bytes) -> str:
    return AESGCM(_key()).decrypt(blob[:12], blob[12:], None).decode()


def keyed_hash(value: str) -> bytes:
    """HMAC-SHA256 for lookups of sensitive values (national ID) without decrypting."""
    return hmac.new(_key(), value.encode(), hashlib.sha256).digest()
