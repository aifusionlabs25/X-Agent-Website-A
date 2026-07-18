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
from urllib.parse import urlsplit
from unittest.mock import patch


INPUT_SCHEMA = "amy_anam_hermes_runtime_input_v1"
OUTPUT_SCHEMA = "amy_anam_hermes_runtime_v1"
SELF_TEST_SCHEMA = "amy_anam_hermes_runtime_self_test_v1"
MAX_STDIN_BYTES = 128 * 1024
MAX_SYSTEM_CHARACTERS = 8_000
MAX_USER_CHARACTERS = 56_000
MAX_RESPONSE_CHARACTERS = 60_000
APPROVED_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
APPROVED_CODEX_RESPONSE_PATH = "/backend-api/codex/responses"
NETWORK_GUARD_VERSION = "amy_anam_codex_exact_endpoint_v1"
SDK_MAX_RETRIES = 0


def _clear_inherited_network_configuration() -> None:
    """Keep the runtime off parent-configured proxies and custom trust roots."""
    for name in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "HERMES_CA_BUNDLE",
    ):
        os.environ.pop(name, None)


def _approved_base_url(value: object) -> bool:
    try:
        parsed = urlsplit(str(value))
        port = parsed.port
    except (TypeError, ValueError):
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "chatgpt.com"
        and port in (None, 443)
        and parsed.username is None
        and parsed.password is None
        and parsed.path.rstrip("/") == "/backend-api/codex"
        and not parsed.query
        and not parsed.fragment
    )


def _approved_provider_request(request: object) -> bool:
    method = str(getattr(request, "method", "")).upper()
    try:
        parsed = urlsplit(str(getattr(request, "url", "")))
        port = parsed.port
    except (TypeError, ValueError):
        return False
    return (
        method == "POST"
        and parsed.scheme == "https"
        and parsed.hostname == "chatgpt.com"
        and port in (None, 443)
        and parsed.username is None
        and parsed.password is None
        and parsed.path == APPROVED_CODEX_RESPONSE_PATH
        and not parsed.query
        and not parsed.fragment
    )


def _approved_provider_send(
    request: object,
    args: tuple[object, ...],
    kwargs: dict[str, object],
) -> bool:
    return (
        not args
        and _approved_provider_request(request)
        and kwargs.get("follow_redirects") in (None, False)
    )


def _strict_http_client_kwargs(
    httpx_module: object,
    base_url: object,
    *,
    async_mode: bool = False,
) -> dict[str, object]:
    if async_mode or not _approved_base_url(base_url):
        raise RuntimeError("Hermes Codex transport endpoint is not approved")
    return {
        "http_client": httpx_module.Client(
            limits=httpx_module.Limits(
                max_keepalive_connections=1,
                max_connections=1,
                keepalive_expiry=5.0,
            ),
            timeout=httpx_module.Timeout(
                connect=15.0,
                read=None,
                write=15.0,
                pool=10.0,
            ),
            proxy=None,
            trust_env=False,
            follow_redirects=False,
            verify=True,
        ),
    }


def _self_test() -> dict[str, object]:
    """Exercise the egress guard without importing Hermes/httpx or using the network."""

    class Request:
        def __init__(self, method: str, url: str) -> None:
            self.method = method
            self.url = url

    class FakeLimits:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    class FakeTimeout:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    class FakeHttpx:
        Client = FakeClient
        Limits = FakeLimits
        Timeout = FakeTimeout

    provider_modules_before = {
        name for name in sys.modules if name == "agent" or name.startswith("agent.")
    }
    httpx_loaded_before = "httpx" in sys.modules
    approved_url = f"{APPROVED_CODEX_BASE_URL}/responses"
    allowed_bases = (
        APPROVED_CODEX_BASE_URL,
        f"{APPROVED_CODEX_BASE_URL}/",
        "https://chatgpt.com:443/backend-api/codex",
    )
    rejected_bases = (
        "http://chatgpt.com/backend-api/codex",
        "https://chatgpt.com.evil.invalid/backend-api/codex",
        "https://chatgpt.com:444/backend-api/codex",
        "https://chatgpt.com/backend-api/codex/other",
        "https://chatgpt.com/backend-api/codex?redirect=true",
    )
    allowed_requests = (
        Request("POST", approved_url),
        Request("post", "https://chatgpt.com:443/backend-api/codex/responses"),
    )
    rejected_requests = (
        Request("POST", "http://chatgpt.com/backend-api/codex/responses"),
        Request("POST", "https://chatgpt.com.evil.invalid/backend-api/codex/responses"),
        Request("POST", "https://chatgpt.com:444/backend-api/codex/responses"),
        Request("POST", "https://chatgpt.com/backend-api/codex/responses/other"),
        Request("POST", f"{approved_url}?redirect=true"),
        Request("GET", approved_url),
        Request("POST", f"{approved_url}#fragment"),
        Request("POST", "https://user@chatgpt.com/backend-api/codex/responses"),
    )

    if not all(_approved_base_url(value) for value in allowed_bases):
        raise AssertionError("approved Codex base URL was rejected")
    if any(_approved_base_url(value) for value in rejected_bases):
        raise AssertionError("unapproved Codex base URL was accepted")
    if not all(_approved_provider_request(request) for request in allowed_requests):
        raise AssertionError("approved Codex request was rejected")
    if any(_approved_provider_request(request) for request in rejected_requests):
        raise AssertionError("unapproved Codex request was accepted")

    exact_request = allowed_requests[0]
    if not _approved_provider_send(exact_request, (), {}):
        raise AssertionError("default no-redirect send was rejected")
    if not _approved_provider_send(exact_request, (), {"follow_redirects": False}):
        raise AssertionError("explicit no-redirect send was rejected")
    if _approved_provider_send(exact_request, (), {"follow_redirects": True}):
        raise AssertionError("redirect-enabled send was accepted")

    client_kwargs = _strict_http_client_kwargs(FakeHttpx, APPROVED_CODEX_BASE_URL)
    http_client = client_kwargs.get("http_client")
    if not isinstance(http_client, FakeClient):
        raise AssertionError("strict transport did not construct the expected client")
    transport = http_client.kwargs
    if (
        transport.get("proxy") is not None
        or transport.get("trust_env") is not False
        or transport.get("follow_redirects") is not False
        or transport.get("verify") is not True
        or SDK_MAX_RETRIES != 0
    ):
        raise AssertionError("strict transport policy is invalid")
    for base_url, async_mode in (
        ("https://chatgpt.com.evil.invalid/backend-api/codex", False),
        (APPROVED_CODEX_BASE_URL, True),
    ):
        try:
            _strict_http_client_kwargs(FakeHttpx, base_url, async_mode=async_mode)
        except RuntimeError:
            pass
        else:
            raise AssertionError("strict transport accepted an unapproved configuration")

    provider_modules_after = {
        name for name in sys.modules if name == "agent" or name.startswith("agent.")
    }
    if provider_modules_after != provider_modules_before or "httpx" in sys.modules != httpx_loaded_before:
        raise AssertionError("self-test imported provider runtime modules")

    return {
        "schema_version": SELF_TEST_SCHEMA,
        "ok": True,
        "network_guard": NETWORK_GUARD_VERSION,
        "provider_endpoint": approved_url,
        "allowed_request_cases": len(allowed_requests),
        "rejected_request_cases": len(rejected_requests),
        "network_requests": 0,
        "provider_imported": bool(provider_modules_after),
        "httpx_imported": "httpx" in sys.modules,
        "redirects_allowed": False,
        "proxy": None,
        "proxy_trust_env": False,
        "tls_verify": True,
        "sdk_max_retries": SDK_MAX_RETRIES,
    }


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
    _clear_inherited_network_configuration()

    logging.disable(logging.CRITICAL)
    client = None
    call_contract: dict[str, object] = {}
    send_contract: dict[str, object] = {}
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            import httpx
            from agent import auxiliary_client

            def strict_http_client_kwargs(
                base_url: object,
                *,
                async_mode: bool = False,
            ) -> dict[str, object]:
                return _strict_http_client_kwargs(
                    httpx,
                    base_url,
                    async_mode=async_mode,
                )

            try:
                # This runtime must not select/rotate a credential-pool entry:
                # selection may refresh OAuth over the network and may accept a
                # pool-supplied base URL. The fallback token reader is local and
                # read-only; an expired token therefore fails closed.
                with (
                    patch.object(
                        auxiliary_client,
                        "_select_pool_entry",
                        return_value=(False, None),
                    ),
                    patch.object(
                        auxiliary_client,
                        "_CODEX_AUX_BASE_URL",
                        APPROVED_CODEX_BASE_URL,
                    ),
                    patch.object(
                        auxiliary_client,
                        "_openai_http_client_kwargs",
                        side_effect=strict_http_client_kwargs,
                    ),
                ):
                    client, resolved_model = auxiliary_client.resolve_provider_client(
                        provider=provider,
                        model=model,
                        async_mode=False,
                    )
                if client is None or resolved_model != model:
                    raise RuntimeError("approved Hermes provider could not be resolved")
                real_client = getattr(client, "_real_client", None)
                responses_api = getattr(real_client, "responses", None)
                original_create = getattr(responses_api, "create", None)
                http_client = getattr(real_client, "_client", None)
                original_send = getattr(http_client, "send", None)
                if (
                    not callable(original_create)
                    or not callable(original_send)
                    or not isinstance(http_client, httpx.Client)
                    or not _approved_base_url(getattr(real_client, "base_url", ""))
                    or getattr(real_client, "max_retries", None) != 0
                    or getattr(http_client, "trust_env", None) is not False
                    or getattr(http_client, "follow_redirects", None) is not False
                ):
                    raise RuntimeError("Hermes Codex transport could not be guarded")

                def guarded_create(*args: object, **kwargs: object) -> object:
                    tools = kwargs.get("tools")
                    if kwargs.get("store") is not False or tools:
                        raise RuntimeError("Hermes runtime attempted a stateful or tool-enabled request")
                    if (
                        args
                        or kwargs.get("model") != model
                        or kwargs.get("stream") is not True
                        or "tools" in kwargs
                    ):
                        raise RuntimeError("Hermes runtime attempted a stateful or tool-enabled request")
                    if int(call_contract.get("calls", 0)) != 0:
                        raise RuntimeError("Hermes runtime attempted more than one provider request")
                    call_contract["provider_store"] = kwargs.get("store")
                    call_contract["tools_enabled"] = len(tools) if isinstance(tools, list) else 0
                    call_contract["calls"] = 1
                    return original_create(*args, **kwargs)

                def guarded_send(request: object, *args: object, **kwargs: object) -> object:
                    if (
                        not _approved_provider_send(request, args, kwargs)
                        or int(send_contract.get("calls", 0)) != 0
                    ):
                        raise RuntimeError("Hermes runtime attempted unapproved network egress")
                    send_contract["calls"] = 1
                    return original_send(request, **kwargs)

                with (
                    patch.object(http_client, "send", side_effect=guarded_send),
                    patch.object(responses_api, "create", side_effect=guarded_create),
                ):
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        timeout=timeout_seconds,
                    )
                text = auxiliary_client.extract_content_or_reasoning(response)
                message = response.choices[0].message
                tool_calls = getattr(message, "tool_calls", None) or []
            finally:
                if client is not None:
                    close_client = getattr(client, "close", None)
                    if callable(close_client):
                        try:
                            close_client()
                        except Exception:
                            pass
                auxiliary_client.shutdown_cached_clients()

    if (
        not isinstance(text, str)
        or not text.strip()
        or len(text) > MAX_RESPONSE_CHARACTERS
        or call_contract.get("calls") != 1
        or send_contract.get("calls") != 1
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
            "network_guard": NETWORK_GUARD_VERSION,
            "provider_endpoint": f"{APPROVED_CODEX_BASE_URL}/responses",
            "provider_requests": send_contract["calls"],
            "oauth_refresh_allowed": False,
            "redirects_allowed": False,
            "proxy_trust_env": False,
            "tls_verify": True,
            "sdk_max_retries": SDK_MAX_RETRIES,
        },
    }


def main() -> int:
    try:
        if sys.argv[1:] == ["--self-test"]:
            result = _self_test()
        elif sys.argv[1:]:
            raise ValueError("runtime arguments are unsupported")
        else:
            result = _run()
    except BaseException:
        sys.stderr.write("Amy Anam Hermes runtime failed\n")
        return 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
