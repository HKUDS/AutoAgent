import re
from autoagent.flow import default_drive, EventInput
from autoagent import MetaChain
from autoagent.types import Response, Agent
from autoagent.registry import register_workflow, registry


def extract_answer(response: str, key: str):
    pattern = f"<{key}>(.*?)</{key}>"
    matches = re.findall(pattern, response, re.DOTALL)
    return matches[0].strip() if len(matches) > 0 else None


def get_research_agent(model: str = "gpt-4o-2024-08-06") -> Agent:
    """Create a research agent equipped with the registered web research tools."""
    web_search = registry.tools.get("web_search")
    visit_url = registry.tools.get("visit_url")
    get_page_markdown = registry.tools.get("get_page_markdown")
    functions = [f for f in [web_search, visit_url, get_page_markdown] if f is not None]

    instructions = (
        "You are a meticulous research assistant. Given a research topic, "
        "conduct multi-step research using the available web tools:\n"
        "1. Break the topic into focused sub-queries.\n"
        "2. Search the web with `web_search` for each sub-query.\n"
        "3. Visit the most promising result URLs with `visit_url`.\n"
        "4. Extract page content with `get_page_markdown`.\n"
        "5. Continue searching and browsing until you have sufficient evidence.\n"
        "6. Synthesize findings into a detailed research report with source URLs cited.\n"
        "Always cite your sources with URLs and present findings in clear sections."
    )
    return Agent(
        name="Research Agent",
        model=model,
        instructions=instructions,
        functions=functions,
    )


def get_synthesizer_agent(model: str = "gpt-4o-2024-08-06") -> Agent:
    """Create a synthesizer agent that turns raw findings into a final research report."""
    instructions = (
        "You are a research synthesizer. Given raw research findings gathered from "
        "web searches and page visits, produce a well-structured final research report. "
        "Include an executive summary, key findings, supporting evidence with cited "
        "source URLs, and a conclusion. Be objective and clearly attribute claims to sources."
    )
    return Agent(
        name="Research Synthesizer",
        model=model,
        instructions=instructions,
        functions=[],
    )


@default_drive.make_event
async def on_start(event: EventInput, global_ctx):
    print("start the workflow: research_workflow")


@default_drive.listen_group([on_start])
async def research_step(event: EventInput, global_ctx):
    inputs = [{'key': 'research_topic', 'description': 'The topic to research.'}]
    input_dict = dict()
    for inp in inputs:
        input_dict[inp["key"]] = global_ctx.get(inp["key"], None)

    messages = global_ctx.get('messages', [])
    task = (
        "Conduct thorough multi-step research on the topic below. "
        "Use web_search, visit_url, and get_page_markdown to gather evidence, "
        "then record your findings (with source URLs) so they can be synthesized.\n"
        "Topic: {topic}"
    ).format(topic=input_dict["research_topic"])
    messages.append({
        "role": "user",
        "content": task
    })
    agent = get_research_agent()
    client = MetaChain()
    response: Response = await client.run_async(
        agent=agent,
        messages=messages,
        context_variables=global_ctx,
        debug=True
    )
    result = response.messages[-1]["content"]
    messages.extend(response.messages)
    global_ctx["messages"] = messages
    global_ctx["research_findings"] = result
    return result


@default_drive.listen_group([research_step])
async def synthesize_step(event: EventInput, global_ctx):
    inputs = [{'key': 'research_findings', 'description': 'Raw research findings from the research step.'}]
    input_dict = dict()
    for inp in inputs:
        input_dict[inp["key"]] = global_ctx.get(inp["key"], None)

    messages = global_ctx.get('messages', [])
    task = (
        "Synthesize the following raw research findings into a final, well-structured "
        "research report. Include an executive summary, key findings, supporting evidence "
        "with cited source URLs, and a conclusion.\n"
        "Findings:\n{findings}"
    ).format(findings=input_dict["research_findings"])
    messages.append({
        "role": "user",
        "content": task
    })
    agent = get_synthesizer_agent()
    client = MetaChain()
    response: Response = await client.run_async(
        agent=agent,
        messages=messages,
        context_variables=global_ctx,
        debug=True
    )
    result = response.messages[-1]["content"]
    messages.extend(response.messages)
    global_ctx["messages"] = messages
    global_ctx["research_report"] = result
    return result


@register_workflow(name="research_workflow")
async def research_workflow(system_input: str):
    storage_results = dict(research_topic=system_input)
    await default_drive.invoke_event(
        on_start,
        global_ctx=storage_results,
    )
    system_output = storage_results.get('research_report', None)
    return system_output


if __name__ == "__main__":
    import asyncio
    print(asyncio.run(research_workflow("What are the latest advances in quantum error correction?")))
