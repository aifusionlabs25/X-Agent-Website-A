"""No-tools, no-session Hermes runtime for Amy's Anam shadow review.

The bounded request arrives over stdin so transcript material never appears in
the process command line. This intentionally uses Hermes' auxiliary Codex
client rather than the full agent or CLI oneshot mode: no tool registry,
memory manager, hooks, skills, or session database are constructed, and the Codex adapter
sends Responses requests with store=False.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch


INPUT_SCHEMA = "amy_anam_hermes_runtime_input_v1"
OUTPUT_SCHEMA = "amy_anam_hermes_runtime_v1"
MAX_STDIN_BYTES = 128 * 1024
MAX_SYSTEM_CHARACTERS = 8_000
MAX_USER_CHARACTERS = 56_000
MAX_RESPONSE_CHARACTERS = 60_000


def _required_env(name: str, maximum: int) -> str:
    value = str(os.environ.get(name, "")).strip()
    if not value or len(value) > maximum:
        raise ValueError(f"{name} is missing or invalid")
    return value


def _read_request() -> tuple[str, str]:
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if not raw or len(raw) > MAX_STDIN_BYTES:
        raise ValueError("runtime input is missing or too large")
    payload = json.loads(raw.decode("utf-8", errors="strict"))
    if not isinstance(payload, dict) or set(payload) != {"schema_version", "system", "user"}:
        raise ValueError("runtime input has an invalid shape")
    if payload.get("schema_version") != INPUT_SCHEMA:
        raise ValueError("runtime input schema is unsupported")
    system = payload.get("system")
    user = payload.get("user")
    if (
        not isinstance(system, str)
        or not system.strip()
        or len(system) > MAX_SYSTEM_CHARACTERS
        or not isinstance(user, str)
        or not user.strip()
        or len(user) > MAX_USER_CHARACTERS
    ):
        raise ValueError("runtime messages are invalid")
    return system.strip(), user.strip()


def _run() -> dict[str, object]:
    provider = _required_env("AMY_ANAM_HERMES_RUNTIME_PROVIDER", 64)
    model = _required_env("AMY_ANAM_HERMES_RUNTIME_MODEL", 128)
    if provider != "openai-codex":
        raise ValueError("runtime provider is not approved")
    timeout_seconds = int(os.environ.get("AMY_ANAM_HERMES_RUNTIME_TIMEOUT_SECONDS", "180"))
    if timeout_seconds < 10 or timeout_seconds > 300:
        raise ValueError("runtime timeout is invalid")
    system, user = _read_request()

    logging.disable(logging.CRITICAL)
    client = None
    call_contract: dict[str, object] = {}
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            from agent.auxiliary_client import (
                extract_content_or_reasoning,
                resolve_provider_client,
                shutdown_cached_clients,
            )

            try:
                client, resolved_model = resolve_provider_client(
                    provider=provider,
                    model=model,
                    async_mode=False,
                )
                if client is None or resolved_model != model:
                    raise RuntimeError("approved Hermes provider could not be resolved")
                real_client = getattr(client, "_real_client", None)
                responses_api = getattr(real_client, "responses", None)
                original_create = getattr(responses_api, "create", None)
                if not callable(original_create):
                    raise RuntimeError("Hermes Codex transport could not be guarded")

                def guarded_create(*args: object, **kwargs: object) -> object:
                    tools = kwargs.get("tools")
                    if kwargs.get("store") is not False or tools:
                        raise RuntimeError("Hermes runtime attempted a stateful or tool-enabled request")
                    call_contract["provider_store"] = kwargs.get("store")
                    call_contract["tools_enabled"] = len(tools) if isinstance(tools, list) else 0
                    call_contract["calls"] = int(call_contract.get("calls", 0)) + 1
                    return original_create(*args, **kwargs)

                with patch.object(responses_api, "create", side_effect=guarded_create):
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        timeout=timeout_seconds,
                    )
                text = extract_content_or_reasoning(response)
                message = response.choices[0].message
                tool_calls = getattr(message, "tool_calls", None) or []
            finally:
                shutdown_cached_clients()

    if (
        not isinstance(text, str)
        or not text.strip()
        or len(text) > MAX_RESPONSE_CHARACTERS
        or call_contract.get("calls") != 1
        or call_contract.get("provider_store") is not False
        or call_contract.get("tools_enabled") != 0
        or tool_calls
    ):
        raise RuntimeError("Hermes runtime response is invalid")

    return {
        "schema_version": OUTPUT_SCHEMA,
        "response": text.strip(),
        "runtime": {
            "client": "hermes_auxiliary_codex",
            "provider": provider,
            "model": model,
            "prompt_transport": "stdin",
            "provider_store": call_contract["provider_store"],
            "tools_enabled": call_contract["tools_enabled"],
            "tools_called": len(tool_calls),
            "memory_enabled": False,
            "memory_writes": 0,
            "session_store_enabled": False,
        },
    }


def main() -> int:
    try:
        result = _run()
    except BaseException:
        sys.stderr.write("Amy Anam Hermes runtime failed\n")
        return 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
