import asyncio
import ast
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from mcp.server.mcpserver import MCPServer


MODULE_PATH = Path(__file__).resolve().parents[1] / "autoagent" / "tools" / "parallel_search.py"
WEB_TOOLS_PATH = Path(__file__).resolve().parents[1] / "autoagent" / "tools" / "web_tools.py"
MODULE_SPEC = importlib.util.spec_from_file_location("autoagent_parallel_search", MODULE_PATH)
parallel_search = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(parallel_search)


@pytest.fixture
def search_server():
    server = MCPServer("search-fixture")
    calls = []
    response = {
        "results": [
            {
                "title": "Fixture result",
                "url": "https://example.test/result",
                "excerpts": ["A deterministic excerpt."],
            }
        ]
    }

    @server.tool()
    async def web_search(objective: str, search_queries: list[str]) -> dict:
        calls.append({"objective": objective, "search_queries": search_queries})
        return response

    return server, calls, response


def test_search_uses_the_mcp_tool_and_formats_its_response(search_server):
    server, calls, response = search_server

    result = parallel_search.ParallelSearchMCP(transport=server).search("fixture query")

    assert calls == [{"objective": "fixture query", "search_queries": ["fixture query"]}]
    assert json.loads(result) == response


def test_search_can_be_called_while_an_event_loop_is_running(search_server):
    server, _, _ = search_server
    search = parallel_search.ParallelSearchMCP(transport=server)

    async def invoke_search():
        return search.search("nested loop query")

    result = asyncio.run(invoke_search())

    assert json.loads(result)["results"][0]["title"] == "Fixture result"


def test_dispatch_defaults_to_bing_and_routes_parallel_explicitly():
    calls = []
    bing_search = lambda query: calls.append(("bing", query)) or "bing result"
    parallel = lambda query: calls.append(("parallel", query)) or "parallel result"

    assert parallel_search.dispatch_search({}, "default query", bing_search, parallel) == "bing result"
    assert calls.pop() == ("bing", "default query")
    assert (
        parallel_search.dispatch_search(
            {"search_provider": "parallel"},
            "selected query",
            bing_search,
            parallel,
        )
        == "parallel result"
    )
    assert calls == [("parallel", "selected query")]


def test_parallel_failure_does_not_fall_back_to_bing():
    bing_calls = []

    def parallel_failure(query):
        raise RuntimeError("fixture failure")

    with pytest.raises(RuntimeError, match="fixture failure"):
        parallel_search.dispatch_search(
            {"search_provider": "parallel"},
            "query",
            lambda query: bing_calls.append(query),
            parallel_failure,
        )

    assert bing_calls == []


def test_http_configuration_uses_keyless_endpoint_and_project_user_agent(monkeypatch):
    captured = {}

    def missing_package_version(distribution_name):
        raise parallel_search.PackageNotFoundError(distribution_name)

    monkeypatch.setattr(parallel_search, "version", missing_package_version)

    class FakeAsyncClient:
        def __init__(self, *, headers, timeout):
            self.headers = headers
            captured["headers"] = headers
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return None

    class FakeClient:
        def __init__(self, transport):
            captured["transport"] = transport

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return None

        async def call_tool(self, name, arguments):
            captured.setdefault("calls", []).append("call_tool")
            captured["tool"] = name
            captured["arguments"] = arguments
            return SimpleNamespace(
                is_error=False,
                structured_content={"results": []},
                content=[],
            )

        async def list_tools(self):
            captured.setdefault("calls", []).append("list_tools")
            return SimpleNamespace(tools=[SimpleNamespace(name="web_search")])

    monkeypatch.setattr(parallel_search.httpx2, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(parallel_search, "Client", FakeClient)
    monkeypatch.setattr(
        parallel_search,
        "streamable_http_client",
        lambda endpoint, *, http_client: captured.update(endpoint=endpoint, http_client=http_client) or "transport",
    )

    result = parallel_search.ParallelSearchMCP().search("configured query")

    assert json.loads(result) == {"results": []}
    assert captured["endpoint"] == "https://search.parallel.ai/mcp"
    assert captured["headers"] == {"User-Agent": "AutoAgent"}
    assert captured["calls"] == ["list_tools", "call_tool"]
    assert captured["tool"] == "web_search"
    assert captured["arguments"] == {
        "objective": "configured query",
        "search_queries": ["configured query"],
    }


def test_user_agent_uses_installed_project_version(monkeypatch):
    monkeypatch.setattr(parallel_search, "version", lambda distribution_name: "1.2.3")

    assert parallel_search.project_user_agent() == "AutoAgent/1.2.3"


def test_search_requires_web_search_tool():
    class MissingToolClient:
        async def list_tools(self):
            return SimpleNamespace(tools=[])

        async def call_tool(self, name, arguments):
            pytest.fail("call_tool must not run without web_search")

    with pytest.raises(RuntimeError, match="required web_search tool"):
        asyncio.run(parallel_search._call_web_search(MissingToolClient(), "fixture query"))


def test_registered_caller_wires_through_the_dispatch_helper():
    module_tree = ast.parse(WEB_TOOLS_PATH.read_text())
    web_search = next(
        node
        for node in module_tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "web_search"
    )
    dispatch_calls = [
        node
        for node in ast.walk(web_search)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "dispatch_search"
    ]

    assert len(dispatch_calls) == 1
    assert [argument.id for argument in dispatch_calls[0].args] == [
        "context_variables",
        "query",
        "bing_search",
        "parallel_search",
    ]
