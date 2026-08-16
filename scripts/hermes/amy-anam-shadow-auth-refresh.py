"""Content-free OAuth refresh helper for Amy's isolated Hermes profile."""

from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SCHEMA_VERSION = "amy_anam_hermes_auth_refresh_helper_v1"
APPROVED_PROVIDER = "openai-codex"
APPROVED_BASE_URL = "https://chatgpt.com/backend-api/codex"


def _bounded_skew() -> int:
    value = int(os.environ.get("AMY_ANAM_HERMES_AUTH_REFRESH_SKEW_SECONDS", "172800"))
    if value < 3600 or value > 604800:
        raise ValueError("refresh skew is outside the approved range")
    return value


def _isolated_home() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    if not raw:
        raise ValueError("isolated Hermes home is missing")
    home = Path(raw)
    if not home.is_absolute() or home.name.lower() == ".hermes":
        raise ValueError("isolated Hermes home is invalid")
    return home.resolve(strict=True)


def _run() -> dict[str, object]:
    home = _isolated_home()
    disabled_recovery = Path(os.environ.get("CODEX_HOME", "")).resolve(strict=False)
    expected_disabled_recovery = (home / "codex-cli-recovery-disabled").resolve(strict=False)
    if disabled_recovery != expected_disabled_recovery:
        raise ValueError("shared Codex credential recovery is not disabled")

    logging.disable(logging.CRITICAL)
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            from hermes_cli.auth import resolve_codex_runtime_credentials

            credentials = resolve_codex_runtime_credentials(
                refresh_if_expiring=True,
                refresh_skew_seconds=_bounded_skew(),
            )

    if (
        credentials.get("provider") != APPROVED_PROVIDER
        or str(credentials.get("base_url", "")).rstrip("/") != APPROVED_BASE_URL
        or not str(credentials.get("api_key", "")).strip()
    ):
        raise RuntimeError("refreshed credential is outside the approved contract")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "ok": True,
        "provider": APPROVED_PROVIDER,
        "baseUrlApproved": True,
        "accessTokenPresent": True,
        "contentIncluded": False,
    }


def main() -> int:
    if sys.argv[1:] == ["--self-test"]:
        print(json.dumps({
            "schemaVersion": SCHEMA_VERSION,
            "ok": True,
            "networkRequests": 0,
            "providerImported": False,
            "contentIncluded": False,
        }, separators=(",", ":")))
        return 0
    if sys.argv[1:]:
        print(json.dumps({
            "schemaVersion": SCHEMA_VERSION,
            "ok": False,
            "failureCode": "unsupported_arguments",
            "contentIncluded": False,
        }, separators=(",", ":")))
        return 2
    try:
        result = _run()
    except BaseException:
        print(json.dumps({
            "schemaVersion": SCHEMA_VERSION,
            "ok": False,
            "failureCode": "credential_refresh_failed",
            "contentIncluded": False,
        }, separators=(",", ":")))
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
