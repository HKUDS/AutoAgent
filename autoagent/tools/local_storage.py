import os
import shutil
import json
import time
from typing import Dict, List, Optional, Union
from pathlib import Path
from constant import LOCAL_STORAGE_PATH
from autoagent.registry import register_tool
from autoagent.environment.docker_env import DockerEnv
from autoagent.environment.local_env import LocalEnv
from typing import Union

class LocalStorageManager:
    """Manager for handling local code storage"""

    def __init__(self, storage_path: str = LOCAL_STORAGE_PATH):
        """
        Initialize the local storage manager

        Args:
            storage_path: Path to the local storage directory
        """
        self.storage_path = storage_path

        # Create storage directory if it doesn't exist
        os.makedirs(self.storage_path, exist_ok=True)

        # Create projects directory if it doesn't exist
        self.projects_path = os.path.join(self.storage_path, "projects")
        os.makedirs(self.projects_path, exist_ok=True)

        # Create metadata file if it doesn't exist
        self.metadata_path = os.path.join(self.storage_path, "metadata.json")
        if not os.path.exists(self.metadata_path):
            with open(self.metadata_path, "w") as f:
                json.dump({"projects": {}}, f)

    def create_project(self, project_name: str, description: str = "") -> Dict:
        """
        Create a new project directory

        Args:
            project_name: Name of the project
            description: Optional project description

        Returns:
            Dict: Result of the operation
        """
        # Sanitize project name
        project_name = self._sanitize_name(project_name)

        # Check if project already exists
        project_path = os.path.join(self.projects_path, project_name)
        if os.path.exists(project_path):
            return {"status": -1, "message": f"Project {project_name} already exists"}

        try:
            # Create project directory
            os.makedirs(project_path, exist_ok=True)

            # Update metadata
            metadata = self._load_metadata()
            metadata["projects"][project_name] = {
                "name": project_name,
                "description": description,
                "created_at": time.time(),
                "updated_at": time.time()
            }
            self._save_metadata(metadata)

            return {"status": 0, "message": f"Project {project_name} created successfully", "path": project_path}
        except Exception as e:
            return {"status": -1, "message": f"Failed to create project: {str(e)}"}

    def delete_project(self, project_name: str) -> Dict:
        """
        Delete a project

        Args:
            project_name: Name of the project to delete

        Returns:
            Dict: Result of the operation
        """
        # Sanitize project name
        project_name = self._sanitize_name(project_name)

        # Check if project exists
        project_path = os.path.join(self.projects_path, project_name)
        if not os.path.exists(project_path):
            return {"status": -1, "message": f"Project {project_name} does not exist"}

        try:
            # Delete project directory
            shutil.rmtree(project_path)

            # Update metadata
            metadata = self._load_metadata()
            if project_name in metadata["projects"]:
                del metadata["projects"][project_name]
            self._save_metadata(metadata)

            return {"status": 0, "message": f"Project {project_name} deleted successfully"}
        except Exception as e:
            return {"status": -1, "message": f"Failed to delete project: {str(e)}"}

    def list_projects(self) -> Dict:
        """
        List all projects

        Returns:
            Dict: List of projects
        """
        try:
            metadata = self._load_metadata()
            return {
                "status": 0,
                "projects": list(metadata["projects"].values())
            }
        except Exception as e:
            return {"status": -1, "message": f"Failed to list projects: {str(e)}"}

    def save_file(self, project_name: str, file_path: str, content: str) -> Dict:
        """
        Save a file to a project

        Args:
            project_name: Name of the project
            file_path: Path to the file within the project
            content: Content of the file

        Returns:
            Dict: Result of the operation
        """
        # Sanitize project name
        project_name = self._sanitize_name(project_name)

        # Check if project exists
        project_path = os.path.join(self.projects_path, project_name)
        if not os.path.exists(project_path):
            return {"status": -1, "message": f"Project {project_name} does not exist"}

        try:
            # Create directory structure if needed
            full_path = os.path.join(project_path, file_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)

            # Write file
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)

            # Update metadata
            metadata = self._load_metadata()
            if project_name in metadata["projects"]:
                metadata["projects"][project_name]["updated_at"] = time.time()
            self._save_metadata(metadata)

            return {"status": 0, "message": f"File {file_path} saved successfully", "path": full_path}
        except Exception as e:
            return {"status": -1, "message": f"Failed to save file: {str(e)}"}

    def read_file(self, project_name: str, file_path: str) -> Dict:
        """
        Read a file from a project

        Args:
            project_name: Name of the project
            file_path: Path to the file within the project

        Returns:
            Dict: Content of the file
        """
        # Sanitize project name
        project_name = self._sanitize_name(project_name)

        # Check if project exists
        project_path = os.path.join(self.projects_path, project_name)
        if not os.path.exists(project_path):
            return {"status": -1, "message": f"Project {project_name} does not exist"}

        try:
            # Read file
            full_path = os.path.join(project_path, file_path)
            if not os.path.exists(full_path):
                return {"status": -1, "message": f"File {file_path} does not exist"}

            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()

            return {"status": 0, "content": content, "path": full_path}
        except Exception as e:
            return {"status": -1, "message": f"Failed to read file: {str(e)}"}

    def list_files(self, project_name: str, directory: str = "") -> Dict:
        """
        List files in a project directory

        Args:
            project_name: Name of the project
            directory: Optional subdirectory within the project

        Returns:
            Dict: List of files
        """
        # Sanitize project name
        project_name = self._sanitize_name(project_name)

        # Check if project exists
        project_path = os.path.join(self.projects_path, project_name)
        if not os.path.exists(project_path):
            return {"status": -1, "message": f"Project {project_name} does not exist"}

        try:
            # List files
            dir_path = os.path.join(project_path, directory)
            if not os.path.exists(dir_path):
                return {"status": -1, "message": f"Directory {directory} does not exist"}

            files = []
            dirs = []

            for item in os.listdir(dir_path):
                item_path = os.path.join(dir_path, item)
                rel_path = os.path.join(directory, item) if directory else item

                if os.path.isfile(item_path):
                    files.append({
                        "name": item,
                        "path": rel_path,
                        "size": os.path.getsize(item_path)
                    })
                elif os.path.isdir(item_path):
                    dirs.append({
                        "name": item,
                        "path": rel_path
                    })

            return {
                "status": 0,
                "files": files,
                "directories": dirs,
                "path": dir_path
            }
        except Exception as e:
            return {"status": -1, "message": f"Failed to list files: {str(e)}"}

    def _sanitize_name(self, name: str) -> str:
        """
        Sanitize a name for use as a directory name

        Args:
            name: Name to sanitize

        Returns:
            str: Sanitized name
        """
        # Replace invalid characters with underscores
        for char in ['/', '\\', ':', '*', '?', '"', '<', '>', '|']:
            name = name.replace(char, '_')

        # Remove leading/trailing whitespace
        name = name.strip()

        # If empty, use default name
        if not name:
            name = f"project_{int(time.time())}"

        return name

    def _load_metadata(self) -> Dict:
        """
        Load metadata from file

        Returns:
            Dict: Metadata
        """
        if os.path.exists(self.metadata_path):
            with open(self.metadata_path, "r") as f:
                return json.load(f)
        return {"projects": {}}

    def _save_metadata(self, metadata: Dict) -> None:
        """
        Save metadata to file

        Args:
            metadata: Metadata to save
        """
        with open(self.metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)


# Register tools for using local storage

@register_tool("create_local_project")
def create_local_project(project_name: str, description: str = "") -> str:
    """
    Create a new local project for storing code

    Args:
        project_name: Name of the project
        description: Optional project description

    Returns:
        str: Result message
    """
    storage = LocalStorageManager()
    result = storage.create_project(project_name, description)

    if result["status"] == 0:
        return f"Successfully created project: {project_name}\nProject path: {result['path']}"
    else:
        return f"Failed to create project: {result['message']}"

@register_tool("list_local_projects")
def list_local_projects() -> str:
    """
    List all local projects

    Returns:
        str: Formatted list of projects
    """
    storage = LocalStorageManager()
    result = storage.list_projects()

    if result["status"] == 0:
        if not result["projects"]:
            return "No projects found"

        output = "Available projects:\n\n"
        for project in result["projects"]:
            created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(project["created_at"]))
            output += f"- {project['name']}\n"
            output += f"  Description: {project['description']}\n"
            output += f"  Created: {created}\n\n"

        return output
    else:
        return f"Failed to list projects: {result['message']}"

@register_tool("save_local_file")
def save_local_file(project_name: str, file_path: str, content: str, context_variables) -> str:
    """
    Save a file to a local project

    Args:
        project_name: Name of the project
        file_path: Path to the file within the project
        content: Content of the file

    Returns:
        str: Result message
    """
    storage = LocalStorageManager()
    result = storage.save_file(project_name, file_path, content)

    if result["status"] == 0:
        return f"Successfully saved file: {file_path}\nFull path: {result['path']}"
    else:
        return f"Failed to save file: {result['message']}"

@register_tool("read_local_file")
def read_local_file(project_name: str, file_path: str) -> str:
    """
    Read a file from a local project

    Args:
        project_name: Name of the project
        file_path: Path to the file within the project

    Returns:
        str: Content of the file or error message
    """
    storage = LocalStorageManager()
    result = storage.read_file(project_name, file_path)

    if result["status"] == 0:
        return f"Content of {file_path}:\n\n{result['content']}"
    else:
        return f"Failed to read file: {result['message']}"

@register_tool("list_local_files")
def list_local_files(project_name: str, directory: str = "") -> str:
    """
    List files in a local project directory

    Args:
        project_name: Name of the project
        directory: Optional subdirectory within the project

    Returns:
        str: Formatted list of files
    """
    storage = LocalStorageManager()
    result = storage.list_files(project_name, directory)

    if result["status"] == 0:
        path_display = f"{project_name}/{directory}" if directory else project_name
        output = f"Contents of {path_display}:\n\n"

        if result["directories"]:
            output += "Directories:\n"
            for dir_info in result["directories"]:
                output += f"- {dir_info['name']}/\n"
            output += "\n"

        if result["files"]:
            output += "Files:\n"
            for file_info in result["files"]:
                size_kb = file_info["size"] / 1024
                output += f"- {file_info['name']} ({size_kb:.1f} KB)\n"

        if not result["directories"] and not result["files"]:
            output += "Directory is empty"

        return output
    else:
        return f"Failed to list files: {result['message']}"
