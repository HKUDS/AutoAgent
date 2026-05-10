import importlib.util
import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient


def load_server(monkeypatch):
    calls = []

    def fake_tool(command, context_variables=None):
        calls.append((command, context_variables))
        return {"status": 0, "result": command}

    registry = types.SimpleNamespace(
        tools={"execute_command": fake_tool},
        agents={},
        agents_info={},
    )
    mod_registry = types.ModuleType("autoagent.registry")
    mod_registry.registry = registry
    mod_autoagent = types.ModuleType("autoagent")
    mod_autoagent.MetaChain = object
    mod_types = types.ModuleType("autoagent.types")
    mod_types.Agent = object
    mod_types.Response = object
    monkeypatch.setitem(sys.modules, "autoagent.registry", mod_registry)
    monkeypatch.setitem(sys.modules, "autoagent", mod_autoagent)
    monkeypatch.setitem(sys.modules, "autoagent.types", mod_types)

    server_path = Path(__file__).resolve().parents[1] / "autoagent" / "server.py"
    spec = importlib.util.spec_from_file_location("autoagent_server_under_test", server_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.create_tool_endpoints()
    return module, calls


def test_tool_endpoint_requires_api_token(monkeypatch):
    monkeypatch.setenv("AUTOAGENT_API_TOKEN", "secret-token")
    module, calls = load_server(monkeypatch)
    client = TestClient(module.app)

    response = client.post(
        "/tools/execute_command",
        json={"args": {"command": "id", "context_variables": {}}},
    )

    assert response.status_code == 401
    assert calls == []


def test_tool_endpoint_accepts_valid_bearer_token(monkeypatch):
    monkeypatch.setenv("AUTOAGENT_API_TOKEN", "secret-token")
    module, calls = load_server(monkeypatch)
    client = TestClient(module.app)

    response = client.post(
        "/tools/execute_command",
        headers={"authorization": "Bearer secret-token"},
        json={"args": {"command": "id", "context_variables": {}}},
    )

    assert response.status_code == 200
    assert calls == [("id", {})]


def test_api_refuses_to_run_when_token_is_unconfigured(monkeypatch):
    monkeypatch.delenv("AUTOAGENT_API_TOKEN", raising=False)
    module, calls = load_server(monkeypatch)
    client = TestClient(module.app)

    response = client.post(
        "/tools/execute_command",
        json={"args": {"command": "id", "context_variables": {}}},
    )

    assert response.status_code == 503
    assert calls == []
