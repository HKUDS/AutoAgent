"""
Text utility tools for AutoAgent.

Lightweight text processing functions registered via the ``@register_tool``
decorator:

- ``word_count``: count the number of words in a text.
- ``text_summarize``: produce a short extractive summary of a text.
- ``extract_urls``: find all URLs in a text.
"""

import re
from typing import List

from autoagent.registry import register_tool


@register_tool("word_count")
def word_count(text: str, context_variables) -> str:
    """
    Count the number of words in a given text. Words are split on whitespace.

    Args:
        text: The text to count words in.
        context_variables: Agent context variables (unused by this tool).

    Returns:
        A string reporting the total word count.
    """
    if not text:
        return "Word count: 0"
    words = text.split()
    return f"Word count: {len(words)}"


@register_tool("text_summarize")
def text_summarize(text: str, max_length: int = 200, context_variables=None) -> str:
    """
    Produce a short extractive summary of a text by keeping the first whole
    sentences that fit within a maximum character length.

    Args:
        text: The text to summarize.
        max_length: Maximum length of the summary in characters (default 200).
        context_variables: Agent context variables (unused by this tool).

    Returns:
        A summarized version of the input text.
    """
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    summary = ""
    for sentence in sentences:
        candidate = f"{summary} {sentence}".strip() if summary else sentence
        if len(candidate) > max_length and summary:
            break
        summary = candidate
    if not summary:
        summary = text.strip()[:max_length]
    return summary


@register_tool("extract_urls")
def extract_urls(text: str, context_variables) -> str:
    """
    Extract all URLs (http/https/www) from a given text.

    Args:
        text: The text to search for URLs.
        context_variables: Agent context variables (unused by this tool).

    Returns:
        A newline-separated list of the URLs found in the text, or a message
        indicating that no URLs were found.
    """
    url_pattern = r"https?://[^\s)\"'<>]+|www\.[^\s)\"'<>]+"
    urls: List[str] = re.findall(url_pattern, text)
    if not urls:
        return "No URLs found."
    return "\n".join(urls)
