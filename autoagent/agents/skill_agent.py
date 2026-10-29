import json
import inspect
from autoagent.types import Agent, Result
from autoagent.registry import register_agent, registry


def run_skill(skill_name: str, skill_args: str, context_variables: dict):
    """
    Execute a registered skill/tool by name.

    Args:
        skill_name: The exact registered name of the skill/tool to execute.
        skill_args: A JSON string of keyword arguments to pass to the skill.
        context_variables: The conversation context variables (injected automatically).

    Returns:
        The result of executing the skill as a string.
    """
    func = registry.tools.get(skill_name) or registry.plugin_tools.get(skill_name)
    if func is None:
        available = ", ".join(list(registry.tools.keys())[:10])
        return f"Error: Skill '{skill_name}' is not registered. Available skills include: {available}"
    try:
        args = json.loads(skill_args) if skill_args and skill_args.strip() else {}
    except (json.JSONDecodeError, TypeError) as e:
        return f"Error: Failed to parse skill_args as JSON: {e}"
    sig = inspect.signature(func)
    if "context_variables" in sig.parameters:
        args["context_variables"] = context_variables
    try:
        result = func(**args)
    except Exception as e:
        return f"Error: Skill '{skill_name}' raised an exception: {e}"
    if isinstance(result, Result):
        return result.value
    if isinstance(result, Agent):
        return json.dumps({"transferred_to": result.name})
    return str(result)


@register_agent(name="Skill Agent", func_name="get_skill_agent")
def get_skill_agent(model: str):
    """
    The skill agent can execute registered skills/tools by name.
    """
    def instructions(context_variables: dict):
        return f"""\
You are a Skill Agent. Your responsibility is to execute registered skills/tools on behalf of the user.

You have access to one function: `run_skill`. Use it to execute any registered skill/tool by name.

AVAILABLE FUNCTION:
- `run_skill(skill_name, skill_args)`: Execute a registered skill/tool.
  - skill_name: The exact registered name of the skill/tool to execute.
  - skill_args: A JSON string of keyword arguments to pass to the skill.

WORKFLOW:
1. Identify which registered skill/tool is needed to complete the user's request.
2. Call `run_skill` with the skill name and a JSON string of arguments.
3. Relay the result back to the user. If the skill is not found, inform the user of the available skills.

Notes:
- `skill_args` must be a valid JSON string, e.g. {{"query": "..."}}.
- The `context_variables` are injected automatically; do not pass them in `skill_args`.
"""
    return Agent(
        name="Skill Agent",
        model=model,
        instructions=instructions,
        functions=[run_skill],
        parallel_tool_calls=False,
    )
