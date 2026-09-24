import asyncio
import json
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import PackageNotFoundError, version
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client


PARALLEL_SEARCH_ENDPOINT = "https://search.parallel.ai/mcp"


def project_user_agent() -> str:
    try:
        return f"AutoAgent/{version('autoagent')}"
    except PackageNotFoundError:
        return "AutoAgent"


def dispatch_search(
    context_variables: Mapping[str, Any],
    query: str,
    bing_search: Callable[[str], Any],
    parallel_search: Callable[[str], Any],
) -> Any:
    search_provider = context_variables.get("search_provider", "bing")
    if search_provider == "bing":
        return bing_search(query)
    if search_provider == "parallel":
        return parallel_search(query)
    raise ValueError(f"Unsupported search provider: {search_provider}")


def _content_text(result: Any) -> str:
    return "\n".join(
        text
        for block in getattr(result, "content", [])
        if (text := getattr(block, "text", None))
    )


async def _call_web_search(client: Client, query: str) -> str:
    tools = await client.list_tools()
    if not any(tool.name == "web_search" for tool in tools.tools):
        raise RuntimeError("The MCP server does not expose the required web_search tool.")
    result = await client.call_tool(
        "web_search",
        {"objective": query, "search_queries": [query]},
    )
    if result.is_error:
        raise RuntimeError(_content_text(result) or "The MCP web_search tool returned an error.")
    if result.structured_content is not None:
        return json.dumps(result.structured_content, ensure_ascii=False, indent=2)
    return _content_text(result)


def _run_async(coroutine):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coroutine).result()


class ParallelSearchMCP:
    def __init__(self, transport=None):
        self._transport = transport

    async def _search_async(self, query: str) -> str:
        if self._transport is not None:
            async with Client(self._transport) as client:
                return await _call_web_search(client, query)

        # Identify the project for aggregate MCP attribution; this header adds no user/device identity.
        async with httpx2.AsyncClient(
            headers={"User-Agent": project_user_agent()},
            timeout=60.0,
        ) as http_client:
            transport = streamable_http_client(
                PARALLEL_SEARCH_ENDPOINT,
                http_client=http_client,
            )
            async with Client(transport) as client:
                return await _call_web_search(client, query)

    def search(self, query: str) -> str:
        return _run_async(self._search_async(query))
