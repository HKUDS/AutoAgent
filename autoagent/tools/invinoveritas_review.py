import os
import json
import requests
from autoagent.registry import register_tool
from typing import Union
from autoagent.environment import DockerEnv, LocalEnv


@register_tool("review_before_push")
def review_before_push(context_variables, concerns: str = ""):
    """
    Get an independent, recomputable second opinion from invinoveritas on the CURRENT diff before
    pushing it — the last check before a change becomes hard to reverse. Calls invinoveritas's
    /review endpoint (https://api.babyblueviper.com) with artifact_type="code_diff" and returns a
    structured verdict (approve / approve_with_concerns / reject) plus ranked issues.

    Requires the INVINOVERITAS_API_KEY environment variable — free registration at
    https://api.babyblueviper.com/register returns an api_key with trial calls per tool; no
    crypto/payment setup is needed to try this.

    Args:
        concerns (str): optional — specific things to check for (e.g. "does this touch the
            payment path?"). Leave empty for a general review.

    Returns:
        str: the verdict, confidence, summary, and any ranked issues found. A "reject" verdict
            should be treated as a blocker; do not push_changes() until it's resolved.
    """
    env: Union[DockerEnv, LocalEnv] = context_variables.get("code_env", LocalEnv())
    diff_command = f"cd {env.docker_workplace}/autoagent && git add -N . && git diff"
    result = env.run_command(diff_command)
    if result["status"] != 0:
        return f"Failed to get the diff to review. Error: {result['result'].strip()}"
    diff = result["result"].strip()
    if not diff:
        return "No staged/unstaged changes to review — nothing to check before push."

    api_key = os.environ.get("INVINOVERITAS_API_KEY", "").strip()
    if not api_key:
        return (
            "INVINOVERITAS_API_KEY is not set — register free at "
            "https://api.babyblueviper.com/register to get one (trial calls included)."
        )

    try:
        resp = requests.post(
            "https://api.babyblueviper.com/review",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"artifact": diff, "artifact_type": "code_diff", "concerns": concerns},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        return f"invinoveritas review call failed: {e}"

    verdict = data.get("verdict", "unknown")
    lines = [
        f"invinoveritas review verdict: {verdict.upper()} (confidence {data.get('confidence', '?')})",
        data.get("summary", ""),
    ]
    issues = data.get("issues") or []
    if issues:
        lines.append("\nIssues:")
        for issue in issues:
            lines.append(
                f"  [{issue.get('severity', '?')}] {issue.get('description', '')} "
                f"-> {issue.get('suggested_fix', 'no fix given')}"
            )
    if verdict == "reject":
        lines.append("\nThis is a BLOCKER — do not push_changes() until the issues above are resolved.")
    return "\n".join(lines)
