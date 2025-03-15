# from autoagent.util import run_command_in_container
from autoagent.environment import DockerEnv, LocalEnv
from constant import GITHUB_AI_TOKEN, LOCAL_STORAGE_ENABLED
from autoagent.tools.github_client import GitHubClient
from autoagent.tools.local_storage import LocalStorageManager
import json
from autoagent.registry import register_tool
from typing import Union

def get_storage_manager():
    """
    Get the appropriate storage manager based on configuration

    Returns:
        Either a GitHub client if token is available or a LocalStorageManager
    """
    if GITHUB_AI_TOKEN and not LOCAL_STORAGE_ENABLED:
        try:
            return GitHubClient(GITHUB_AI_TOKEN)
        except ValueError:
            print("GitHub token not available, falling back to local storage")
            return LocalStorageManager()
    else:
        return LocalStorageManager()

@register_tool("get_current_branch")
def get_current_branch(context_variables):
    f"""
    Get the current branch of the 'autoagent'.
    """
    env: Union[DockerEnv, LocalEnv] = context_variables.get("code_env", LocalEnv())
    branch_command = f"cd {env.docker_workplace}/autoagent && git branch --show-current"
    result = env.run_command(branch_command)
    if result['status'] == 0:
        return result['result'].strip()
    else:
        return f"Failed to get the current branch. Error: {result['result'].strip()}"

@register_tool("get_diff")
def get_diff(context_variables):
    f"""
    Get the diff of the 'autoagent'.
    """
    env: Union[DockerEnv, LocalEnv] = context_variables.get("code_env", LocalEnv())
    diff_command = f"cd {env.docker_workplace}/autoagent && git add -N . && git diff"
    result = env.run_command(diff_command)
    if result['status'] == 0:
        return result['result'].strip()
    else:
        return f"Failed to get the diff. Error: {result['result'].strip()}"

@register_tool("stage_files")
def stage_files(context_variables, file_paths=None):
    """
    Stage the specified file changes

    Args:
        file_paths (list): The file paths to stage, if None, add all changes to the staging area

    Returns:
        dict: The operation result
    """
    env: Union[DockerEnv, LocalEnv] = context_variables.get("code_env", LocalEnv())
    if file_paths is None:
        # add all changes to the staging area
        command = f"cd {env.docker_workplace}/autoagent && git add ."
    else:
        # add specified files to the staging area
        files = ' '.join(file_paths)
        command = f"cd {env.docker_workplace}/autoagent && git add {files}"

    result = env.run_command(command)
    return result

@register_tool("push_changes")
def push_changes(context_variables, commit_message, file_paths=None):
    """
    Push the selected changes to the remote repository

    Args:
        commit_message (str): The commit message
        file_paths (list): The file paths to commit, if None, commit all changes

    Returns:
        dict: The push result
    """
    # stage the files
    # if file_paths:
    env: Union[DockerEnv, LocalEnv] = context_variables.get("code_env", LocalEnv())
    stage_result = stage_files(env, file_paths)
    if stage_result['status'] != 0:
        return json.dumps({'status': 'error', 'message': f"Failed to stage files: {stage_result['result']}"}, indent=4)

    commands = [
        f"cd {env.docker_workplace}/autoagent",
        f'git commit -m "{commit_message}"',
        "git push origin $(git branch --show-current)"
    ]

    command = " && ".join(commands)
    result = env.run_command(command)

    if result['status'] == 0:
        return f"push success. {result['result']}"
    else:
        return f"push failed. {result['result']}"

@register_tool("submit_pull_request")
def submit_pull_request(title: str, body: str, target_branch: str):
    """
    Submit a Pull Request or save changes locally

    Args:
        title: PR title or project name
        body: PR description or project description
        target_branch: target branch or directory path
    """
    # Check if GitHub is available
    if GITHUB_AI_TOKEN and not LOCAL_STORAGE_ENABLED:
        # Initialize GitHub client
        github = GitHubClient(GITHUB_AI_TOKEN)

        # Check authentication
        auth_result = github.check_auth()
        if auth_result['status'] != 0:
            return f"GitHub authentication failed: {auth_result['message']}. Falling back to local storage."

        # Create a pull request
        pr_result = github.create_pull_request(
            repo="tjb-tech/autoagent",
            title=title,
            body=body,
            head=get_current_branch(),
            base=target_branch
        )

        if pr_result['status'] == 0:
            return f"PR created successfully: {json.dumps(pr_result, indent=4)}"
        else:
            return f"PR creation failed: {json.dumps(pr_result, indent=4)}"
    else:
        # Use local storage instead
        storage = LocalStorageManager()

        # Create a project with the PR title
        project_result = storage.create_project(title, body)

        if project_result['status'] == 0:
            return f"Changes saved locally. Project created: {project_result['path']}"
        else:
            return f"Failed to save changes locally: {project_result['message']}"

# def create_pull_request(title, body, target_branch):
#     """
#     Create a Pull Request to the target branch

#     Args:
#         title (str): The title of the PR
#         body (str): The description content of the PR
#         target_branch (str): The target branch name

#     Returns:
#         dict: PR creation result
#     """

#     # use gh to create a PR. make sure the gh cli is installed in the container and the github token is set
#     pr_command = f"""cd /{DOCKER_WORKPLACE_NAME}/autoagent && \
#         gh pr create \
#         --title "{title}" \
#         --body "{body}" \
#         --base {target_branch} \
#         --head $(git branch --show-current)"""

#     result = run_command_in_container(pr_command)

#     if result['status'] == 0:
#         return f"PR created successfully: {result['result']}"
#     else:
#         return f"PR creation failed: {result['result']}"
if __name__ == "__main__":
    from rich import print
    print("Current branch: " + get_current_branch())
    print("Diff: " + get_diff())
    print(push_changes(commit_message="test"))
    print(submit_pull_request(title="test", body="test", target_branch="test_pull_1107"))
