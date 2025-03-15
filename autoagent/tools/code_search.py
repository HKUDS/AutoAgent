import requests
from typing import Optional, List, Dict
from autoagent.tools.github_client import GitHubSearcher
from autoagent.tools.local_storage import LocalStorageManager
from autoagent.registry import register_tool
from constant import GITHUB_AI_TOKEN, LOCAL_STORAGE_ENABLED
import json
import os
import glob

@register_tool("search_github_repos")
def search_github_repos(query, limit=5):
    """
    Search GitHub public repositories based on a keyword.

    :param query: The query to search for in repository names or descriptions.
    :param limit: The total number of repositories to return.
    :return: A list of dictionaries containing repository details, limited to the specified number.
    """
    repos = []
    per_page = 10
    page = 1
    while len(repos) < limit:

        url = f'https://api.github.com/search/repositories?q={query}&per_page={per_page}&page={page}'

        response = requests.get(url)

        if response.status_code == 200:
            items = response.json().get('items', [])
            for item in items:
                formatted_repo = {
                    "name": f"{item['owner']['login']}/{item['name']}",
                    "author": item['owner']['login'],
                    "description": item['description'],
                    "link": item['html_url']
                }
                repos.append(formatted_repo)
                if len(repos) >= limit:
                    break

            if len(items) < per_page:  # Stop if there are no more repos to fetch
                break
            page += 1
        else:
            raise Exception(f"GitHub API request failed with status code {response.status_code}: {response.text}")

    return_str = """
    Here are some of the repositories I found on GitHub:
    """

    for repo in repos:
        return_str += f"""
        Name: {repo['name']}
        Description: {repo['description']}
        Link: {repo['link']}
        """

    return return_str

@register_tool("search_github_code")
def search_github_code(repo_owner: str,
                      repo_name: str,
                      query: str,
                      language: Optional[str] = None,
                      per_page: int = 5,
                      page: int = 1) -> List[Dict]:
    """
    Search code in GitHub or local storage based on a keyword.

    Args:
        repo_owner: The owner of the repository or project name for local storage
        repo_name: The name of the repository or directory for local storage
        query: The keyword to search for
        language: The programming language to filter by, optional
        per_page: The number of results per page, optional
        page: The page number, optional

    Returns:
        List[Dict]: The search results list
    """
    # Try GitHub search if token is available and not explicitly using local storage
    if GITHUB_AI_TOKEN and not LOCAL_STORAGE_ENABLED:
        try:
            searcher = GitHubSearcher(GITHUB_AI_TOKEN)
            results = searcher.search_code(repo_owner, repo_name, query, language, per_page, page)

            if 'items' not in results:
                # Fall back to local search if GitHub search fails
                return search_local_code(repo_owner, query, language)

            # Extract useful information
            formatted_results = []
            for item in results['items']:
                response = requests.get(item['url'])
                if response.status_code == 200:
                    download_url = response.json()['download_url']
                    response = requests.get(download_url)
                    if response.status_code == 200:
                        content = response.text
                    else:
                        content = ""
                else:
                    content = ""
                formatted_results.append({
                    'name': item['name'],
                    'path': item['path'],
                    'url': item['html_url'],
                    'repository': item['repository']['full_name'],
                    'content_url': item['url'],
                    'content': content
                })

            return json.dumps(formatted_results, indent=4)
        except Exception as e:
            # Fall back to local search if GitHub search fails
            return search_local_code(repo_owner, query, language)
    else:
        # Use local search
        return search_local_code(repo_owner, query, language)

def search_local_code(project_name: str, query: str, language: Optional[str] = None) -> str:
    """
    Search code in local storage

    Args:
        project_name: Name of the local project
        query: The search query
        language: Optional language filter

    Returns:
        str: JSON string of search results
    """
    storage = LocalStorageManager()

    # Check if project exists
    project_path = os.path.join(storage.projects_path, project_name)
    if not os.path.exists(project_path):
        return json.dumps([{"error": f"Project {project_name} not found"}])

    # Build file pattern based on language filter
    if language:
        extensions = get_extensions_for_language(language)
        file_patterns = [f"{project_path}/**/*.{ext}" for ext in extensions]
    else:
        file_patterns = [f"{project_path}/**/*"]

    # Search for matching files
    results = []
    for pattern in file_patterns:
        for file_path in glob.glob(pattern, recursive=True):
            if os.path.isfile(file_path):
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()

                    # Check if query is in the content
                    if query.lower() in content.lower():
                        rel_path = os.path.relpath(file_path, project_path)
                        results.append({
                            'name': os.path.basename(file_path),
                            'path': rel_path,
                            'repository': project_name,
                            'content': content
                        })
                except Exception as e:
                    # Skip files that can't be read
                    continue

    return json.dumps(results, indent=4)

def get_extensions_for_language(language: str) -> List[str]:
    """
    Get file extensions for a programming language

    Args:
        language: The programming language

    Returns:
        List[str]: List of file extensions
    """
    language_map = {
        "python": ["py", "pyw", "ipynb"],
        "javascript": ["js", "jsx", "mjs"],
        "typescript": ["ts", "tsx"],
        "java": ["java"],
        "c": ["c", "h"],
        "cpp": ["cpp", "cc", "cxx", "hpp", "hxx", "h"],
        "csharp": ["cs"],
        "go": ["go"],
        "rust": ["rs"],
        "ruby": ["rb"],
        "php": ["php"],
        "html": ["html", "htm"],
        "css": ["css"],
        "shell": ["sh", "bash"],
        "markdown": ["md", "markdown"],
        "json": ["json"],
        "yaml": ["yml", "yaml"],
    }

    return language_map.get(language.lower(), ["*"])
