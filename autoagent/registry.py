from typing import Callable, Dict, Any, Union, Literal, List, Optional
from dataclasses import dataclass, asdict
import inspect
import os
import functools
import tiktoken
MAX_OUTPUT_LENGTH = 12000

def encode_string_by_tiktoken(content: str, model_name: str = "gpt-4o"):
    ENCODER = tiktoken.encoding_for_model(model_name)
    tokens = ENCODER.encode(content)
    return tokens


def decode_tokens_by_tiktoken(tokens: list[int], model_name: str = "gpt-4o"):
    ENCODER = tiktoken.encoding_for_model(model_name)
    content = ENCODER.decode(tokens)
    return content
def truncate_output(output: str, max_length: int = MAX_OUTPUT_LENGTH) -> str:
    """Truncate output if it exceeds max_length"""
    tokens = encode_string_by_tiktoken(output)
    if len(tokens) > max_length:
        return decode_tokens_by_tiktoken(tokens[:max_length]) + f"\n\n[TOOL WARNING] Output truncated, exceeded {max_length} tokens)\n[TOOL SUGGESTION] Maybe this tool with direct output is not an optimal choice, consider save the output to a file in the `workplace/` directory to implement the same functionality."
    return output

@dataclass
class FunctionInfo:
    name: str
    func_name: str
    func: Callable
    args: List[str]
    docstring: Optional[str]
    body: str
    return_type: Optional[str]
    file_path: Optional[str]
    def to_dict(self) -> dict:
        # using asdict, but exclude func field because it cannot be serialized
        d = asdict(self)
        d.pop('func')  # remove func field
        return d
    
    @classmethod
    def from_dict(cls, data: dict) -> 'FunctionInfo':
        # if you need to create an object from a dictionary
        if 'func' not in data:
            data['func'] = None  # or other default value
        return cls(**data)
class Registry:
    _instance = None
    _registry: Dict[str, Dict[str, Callable]] = {
        "tools": {},
        "agents": {}, 
        "plugin_tools": {}, 
        "plugin_agents": {},
        "workflows": {}
    }
    _registry_info: Dict[str, Dict[str, FunctionInfo]] = {
        "tools": {},
        "agents": {},
        "plugin_tools": {},
        "plugin_agents": {},
        "workflows": {}
    }
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def register(self, 
                type: Literal["tool", "agent", "plugin_tool", "plugin_agent", "workflow"],
                name: str = None,
                func_name: str = None):
        """
        统一的注册装饰器
        Args:
            type: 注册类型，"tool" 或 "agent"
            name: 可选的注册名称
        """
        def decorator(func: Callable):
            nonlocal name
            if name is None:
                name = func.__name__
                # if type == "agent" and name.startswith('get_'):
                #     name = name[4:]  # 对 agent 移除 'get_' 前缀
            # 获取函数的文件路径

            if type == "plugin_tool":
                original_func = func  # 保存原始函数
                @functools.wraps(original_func)
                def wrapped_func(*args, **kwargs):
                    result = original_func(*args, **kwargs)  # 调用原始函数
                    if isinstance(result, str):
                        return truncate_output(result)
                    return result
            else:
                wrapped_func = func
            try:
                file_path = os.path.abspath(inspect.getfile(func))
            except (TypeError, OSError):
                file_path = "Unknown"
            
            # 获取函数信息
            signature = inspect.signature(func)
            args = list(signature.parameters.keys())
            docstring = inspect.getdoc(func)
            
            # 获取函数体
            source_lines = inspect.getsource(func)
            # 移除装饰器和函数定义行
            body_lines = source_lines.split('\n')[1:]  # 跳过装饰器行
            while body_lines and (body_lines[0].strip().startswith('@') or 'def ' in body_lines[0]):
                body_lines = body_lines[1:]
            body = '\n'.join(body_lines)
            
            # 获取返回类型提示
            return_type = None
            if signature.return_annotation != inspect.Signature.empty:
                return_type = str(signature.return_annotation)
            
            # 创建函数信息对象
            func_info = FunctionInfo(
                name=name,
                func_name=func_name,
                func=wrapped_func if type == "plugin_tool" else func,
                args=args,
                docstring=docstring,
                body=body,
                return_type=return_type, 
                file_path=file_path  # 添加文件路径
            )
            
            registry_type = f"{type}s"
            self._registry[registry_type][func_name] = wrapped_func if type == "plugin_tool" else func
            self._registry_info[registry_type][name] = func_info
            return wrapped_func if type == "plugin_tool" else func
        return decorator
    
    @property
    def tools(self) -> Dict[str, Callable]:
        return self._registry["tools"]
    
    @property
    def agents(self) -> Dict[str, Callable]:
        return self._registry["agents"]
    
    @property
    def plugin_tools(self) -> Dict[str, Callable]:
        return self._registry["plugin_tools"]
    
    @property
    def plugin_agents(self) -> Dict[str, Callable]:
        return self._registry["plugin_agents"]
    
    @property
    def workflows(self) -> Dict[str, Callable]:
        return self._registry["workflows"]
    
    @property
    def tools_info(self) -> Dict[str, FunctionInfo]: 
        return self._registry_info["tools"]
    
    @property
    def agents_info(self) -> Dict[str, FunctionInfo]: 
        return self._registry_info["agents"]
    
    @property
    def plugin_tools_info(self) -> Dict[str, FunctionInfo]: 
        return self._registry_info["plugin_tools"]
    
    @property
    def plugin_agents_info(self) -> Dict[str, FunctionInfo]: 
        return self._registry_info["plugin_agents"]
    
    @property
    def workflows_info(self) -> Dict[str, FunctionInfo]:
        return self._registry_info["workflows"]
    
    @property
    def display_plugin_tools_info(self):
        display_info = {}
        for name, info in self.plugin_tools_info.items():
            tmp_info = info.to_dict().copy()
            tmp_info.pop('func', None)
            display_info[name] = tmp_info
        return display_info
    
    @property
    def display_plugin_agents_info(self):
        display_info = {}
        for name, info in self.plugin_agents_info.items():
            tmp_info = info.to_dict().copy()
            tmp_info.pop('func', None)
            display_info[name] = tmp_info
        return display_info
    
    @property
    def display_workflows_info(self):
        display_info = {}
        for name, info in self.workflows_info.items():
            tmp_info = info.to_dict().copy()
            tmp_info.pop('func', None)
            display_info[name] = tmp_info
        return display_info

# 创建全局实例
registry = Registry()

# 便捷的注册函数
def register_tool(name: str = None):
    func_name = name
    return registry.register(type="tool", name=name, func_name=func_name)

def register_agent(name: str = None, func_name: str = None):
    return registry.register(type="agent", name=name, func_name=func_name)

def register_plugin_tool(name: str = None):
    func_name = name
    return registry.register(type="plugin_tool", name=name, func_name=func_name)

def register_plugin_agent(name: str = None, func_name: str = None):
    return registry.register(type="plugin_agent", name=name, func_name=func_name)

def register_workflow(name: str = None):
    func_name = name
    return registry.register(type="workflow", name=name, func_name=func_name)