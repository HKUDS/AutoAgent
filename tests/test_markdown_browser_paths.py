import importlib.util
import sys
import types
from pathlib import Path


def load_browser(monkeypatch):
    monkeypatch.setitem(sys.modules, "pathvalidate", types.ModuleType("pathvalidate"))
    for name in ["autoagent", "autoagent.environment", "autoagent.environment.markdown_browser"]:
        package = types.ModuleType(name)
        package.__path__ = []
        monkeypatch.setitem(sys.modules, name, package)

    abstract = types.ModuleType("autoagent.environment.markdown_browser.abstract_markdown_browser")
    abstract.AbstractMarkdownBrowser = object
    monkeypatch.setitem(sys.modules, abstract.__name__, abstract)

    search = types.ModuleType("autoagent.environment.markdown_browser.markdown_search")
    search.AbstractMarkdownSearch = object

    class BingMarkdownSearch:
        def search(self, query):
            return ""

    search.BingMarkdownSearch = BingMarkdownSearch
    monkeypatch.setitem(sys.modules, search.__name__, search)

    mdconvert = types.ModuleType("autoagent.environment.markdown_browser.mdconvert")

    class FileConversionException(Exception):
        pass

    class UnsupportedFormatException(Exception):
        pass

    class MarkdownConverter:
        def convert_local(self, path):
            return types.SimpleNamespace(title=None, text_content=Path(path).read_text(errors="replace"))

        def convert_response(self, response):
            return types.SimpleNamespace(title=None, text_content="")

    mdconvert.FileConversionException = FileConversionException
    mdconvert.UnsupportedFormatException = UnsupportedFormatException
    mdconvert.MarkdownConverter = MarkdownConverter
    monkeypatch.setitem(sys.modules, mdconvert.__name__, mdconvert)

    browser_path = (
        Path(__file__).resolve().parents[1]
        / "autoagent"
        / "environment"
        / "markdown_browser"
        / "requests_markdown_browser.py"
    )
    spec = importlib.util.spec_from_file_location(
        "autoagent.environment.markdown_browser.requests_markdown_browser",
        browser_path,
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module.RequestsMarkdownBrowser


def test_docker_path_conversion_rejects_workspace_escape(monkeypatch, tmp_path):
    RequestsMarkdownBrowser = load_browser(monkeypatch)
    (tmp_path / "workplace").mkdir()
    (tmp_path / "secret.txt").write_text("secret")
    browser = RequestsMarkdownBrowser(local_root=str(tmp_path), workplace_name="workplace", start_page="about:blank")

    try:
        browser._convert_docker_to_local("/workplace/../secret.txt")
    except ValueError as exc:
        assert "escapes the workspace" in str(exc)
    else:
        raise AssertionError("workspace escape was accepted")


def test_docker_path_conversion_allows_workspace_file(monkeypatch, tmp_path):
    RequestsMarkdownBrowser = load_browser(monkeypatch)
    workplace = tmp_path / "workplace"
    workplace.mkdir()
    safe_file = workplace / "note.txt"
    safe_file.write_text("ok")
    browser = RequestsMarkdownBrowser(local_root=str(tmp_path), workplace_name="workplace", start_page="about:blank")

    converted = browser._convert_docker_to_local("/workplace/note.txt")

    assert Path(converted) == safe_file.resolve()
    assert browser.open_local_file(converted).strip() == "ok"


def test_local_path_conversion_rejects_sibling_prefix(monkeypatch, tmp_path):
    RequestsMarkdownBrowser = load_browser(monkeypatch)
    (tmp_path / "workplace").mkdir()
    sibling = tmp_path / "workplace-other" / "secret.txt"
    sibling.parent.mkdir()
    sibling.write_text("secret")
    browser = RequestsMarkdownBrowser(local_root=str(tmp_path), workplace_name="workplace", start_page="about:blank")

    try:
        browser._convert_local_to_docker(str(sibling))
    except ValueError as exc:
        assert "escapes the workspace" in str(exc)
    else:
        raise AssertionError("sibling prefix path was accepted")
