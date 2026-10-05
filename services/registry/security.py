from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    key = os.environ.get('ENCRYPTION_KEY', '').strip()
    if not key:
        raise RuntimeError('ENCRYPTION_KEY is required')
    return Fernet(key.encode('ascii'))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode('utf-8')).decode('ascii')


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode('ascii')).decode('utf-8')
    except InvalidToken as exc:
        raise RuntimeError('ENCRYPTION_KEY does not match stored secret') from exc
