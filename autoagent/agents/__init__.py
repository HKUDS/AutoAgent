# from autoagent.agents.programming_agent import get_programming_agent
# from autoagent.agents.tool_retriver_agent import get_tool_retriver_agent
# from autoagent.agents.agent_check_agent import get_agent_check_agent
# from autoagent.agents.tool_check_agent import get_tool_check_agent
# from autoagent.agents.github_agent import get_github_agent
# from autoagent.agents.programming_triage_agent import get_programming_triage_agent
# from autoagent.agents.plan_agent import get_plan_agent


import importlib
from typing import Set, Optional

# Whitelist of allowed modules - add modules as needed
ALLOWED_MODULES: Set[str] = {
    'autoagent.agents.base_agent',
    'autoagent.agents.planning_agent',
    'autoagent.agents.execution_agent',
    'autoagent.agents.memory_agent',
    'autoagent.agents.tool_agent',
    # Add other legitimate modules here
}

def secure_import_module(module_name: str, package: Optional[str] = None):
    """
    Securely import a module using a whitelist approach.
    
    Args:
        module_name: Name of the module to import
        package: Package name for relative imports
        
    Returns:
        The imported module
        
    Raises:
        SecurityError: If module is not in the whitelist
        ImportError: If module cannot be imported
    """
    # Normalize the module name
    if package and module_name.startswith('.'):
        full_module_name = package + module_name
    else:
        full_module_name = module_name
    
    # Check against whitelist
    if full_module_name not in ALLOWED_MODULES:
        raise SecurityError(f"Module '{full_module_name}' is not in the allowed modules list")
    
    # Import the module safely
    return importlib.import_module(module_name, package)

class SecurityError(Exception):
    """Raised when attempting to import unauthorized modules"""
    pass



# import os
# import importlib
# from autoagent.registry import registry

# # 获取当前目录下的所有 .py 文件
# current_dir = os.path.dirname(__file__)
# for file in os.listdir(current_dir):
#     if file.endswith('.py') and not file.startswith('__'):
#         module_name = file[:-3]
#         secure_import_module(f'autoagent.agents.{module_name}')

# # 导出所有注册的 agent 创建函数
# globals().update(registry.agents)

# __all__ = list(registry.agents.keys())

import os
import importlib
from autoagent.registry import registry

def import_agents_recursively(base_dir: str, base_package: str):
    """Recursively import all agents in .py files
    
    Args:
        base_dir: the root directory to start searching
        base_package: the base name of the Python package
    """
    for root, dirs, files in os.walk(base_dir):
        # get the relative path to the base directory
        rel_path = os.path.relpath(root, base_dir)
        
        for file in files:
            if file.endswith('.py') and not file.startswith('__'):
                # build the module path
                if rel_path == '.':
                    # in the root directory
                    module_path = f"{base_package}.{file[:-3]}"
                else:
                    # in the subdirectory
                    package_path = rel_path.replace(os.path.sep, '.')
                    module_path = f"{base_package}.{package_path}.{file[:-3]}"
                
                try:
                    secure_import_module(module_path)
                except Exception as e:
                    print(f"Warning: Failed to import {module_path}: {e}")

# get the current directory and import all agents
current_dir = os.path.dirname(__file__)
import_agents_recursively(current_dir, 'autoagent.agents')

# export all agent creation functions
globals().update(registry.agents)
globals().update(registry.plugin_agents)

__all__ = list(registry.agents.keys())