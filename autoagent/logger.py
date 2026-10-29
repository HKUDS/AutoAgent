from datetime import datetime
from rich.console import Console
from rich.markup import escape
import json
from typing import List
from constant import DEBUG, DEFAULT_LOG, LOG_PATH, MC_MODE
from pathlib import Path
BAR_LENGTH = 60
class MetaChainLogger:
    def __init__(self, log_path: str):
        self.log_path = log_path
        self.console = Console()
        self.debug = DEBUG
        
    def _write_log(self, message: str):
        if self.log_path is None:
            return
        with open(self.log_path, 'a') as f:
            f.write(message + '\n')
    def _warp_args(self, args_dict: str):
        args_dict = json.loads(args_dict)
        args_str = ''
        for k, v in args_dict.items():
            args_str += f"{repr(k)}={repr(v)}, "
        return args_str[:-2]
    def _wrap_title(self, title: str, color: str = None):
        single_len = (BAR_LENGTH - len(title)) // 2
        color_bos = f"[{color}]" if color else ""
        color_eos = f"[/{color}]" if color else ""
        return f"{color_bos}{'*'*single_len} {title} {'*'*single_len}{color_eos}"
    def info(self, *args: str, **kwargs: dict):
        # console = Console()
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message = "\n".join(map(str, args))
        color = kwargs.get("color", "white")
        if MC_MODE: color = "grey58"
        title = kwargs.get("title", "INFO")
        log_str = f"[{timestamp}]\n{message}"
        if self.debug: 
            # print_in_box(log_str, color=color, title=title)
            self.console.print(self._wrap_title(title, f"bold {color}"))
            print_str = escape(log_str)
            if MC_MODE: print_str = f"[grey58]{print_str}[/grey58]"
            self.console.print(print_str, highlight=True, emoji=True)
        log_str = self._wrap_title(title) + "\n" + log_str
        if self.log_path: self._write_log(log_str) 
    def error(self, *args: str, **kwargs: dict):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message = "\n".join(map(str, args))
        color = kwargs.get("color", "red")
        if MC_MODE: color = "grey58"
        title = kwargs.get("title", "ERROR")
        log_str = f"[{timestamp}]\n{message}"
        self.console.print(self._wrap_title(title, f"bold {color}"))
        print_str = escape(log_str)
        if MC_MODE: print_str = f"[grey58]{print_str}[/grey58]"
        self.console.print(print_str, highlight=True, emoji=True)
        log_str = self._wrap_title(title) + "\n" + log_str
        if self.log_path: self._write_log(log_str) 
    def lprint(self, *args: str, **kwargs: dict):
        if not self.debug: return
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message = "\n".join(map(str, args))
        color = kwargs.get("color", "white")
        if MC_MODE: color = "grey58"
        title = kwargs.get("title", "")
        log_str = f"[{timestamp}]\n{message}"
            # print_in_box(log_str, color=color, title=title)
        self.console.print(self._wrap_title(title, f"bold {color}"))
        print_str = escape(log_str)
        if MC_MODE: print_str = f"[grey58]{print_str}[/grey58]"
        self.console.print(print_str, highlight=True, emoji=True)
        
    def _wrap_timestamp(self, timestamp: str, color: bool = True):
        color_bos = "[grey58]" if color else ""
        color_eos = "[/grey58]" if color else ""
        return f"{color_bos}[{timestamp}]{color_eos}"
    def _print_tool_execution(self, message, timestamp: str):
        if MC_MODE: colors = ["grey58"] * 3
        else: colors = ["pink3", "blue", "purple"]
        self.console.print(self._wrap_title("Tool Execution", f"bold {colors[0]}"))
        self.console.print(self._wrap_timestamp(timestamp, color=True))
        self.console.print(f"[bold {colors[1]}]Tool Execution:[/bold {colors[1]}]", end=" ")
        self.console.print(f"[bold {colors[2]}]{message['name']}[/bold {colors[2]}]\n[bold {colors[1]}]Result:[/bold {colors[1]}]")
        print_str = f"---\n{escape(message['content'])}\n---"
        if MC_MODE: print_str = f"[grey58]{print_str}[/grey58]"
        self.console.print(print_str, highlight=True, emoji=True)
    def _save_tool_execution(self, message, timestamp: str):
        self._write_log(self._wrap_title("Tool Execution"))
        self._write_log(f"{self._wrap_timestamp(timestamp, color=False)}\ntool execution: {message['name']}\nResult:\n---\n{message['content']}\n---")
    def _print_assistant_message(self, message, timestamp: str):
        if MC_MODE: colors = ["grey58"] * 3
        else: colors = ["light_salmon3", "blue", "purple"]
        self.console.print(self._wrap_title("Assistant Message", f"bold {colors[0]}"))
        self.console.print(f"{self._wrap_timestamp(timestamp, color=True)}\n[bold {colors[1]}]{message['sender']}[/bold {colors[1]}]:", end=" ")
        if message["content"]: 
            print_str = escape(message["content"])
            if MC_MODE: print_str = f"[grey58]{print_str}[/grey58]"
            self.console.print(print_str, highlight=True, emoji=True) 
        else: 
            print_str = None
            if MC_MODE: print_str = "[grey58]None[/grey58]"
            self.console.print(print_str, highlight=True, emoji=True)
    def _save_assistant_message(self, message, timestamp: str):
        self._write_log(self._wrap_title("Assistant Message"))
        content = message["content"] if message["content"] else None
        self._write_log(f"{self._wrap_timestamp(timestamp, color=False)}\n{message['sender']}: {content}")
    def _print_tool_call(self, tool_calls: List, timestamp: str):
        if MC_MODE: colors = ["grey58"] * 3
        else: colors = ["light_pink1", "blue", "purple"]
        if len(tool_calls) >= 1: self.console.print(self._wrap_title("Tool Calls", f"bold {colors[0]}"))

        for tool_call in tool_calls:
            f = tool_call["function"]
            name, args = f["name"], f["arguments"]
            arg_str = self._warp_args(args)
            print_arg_str = escape(arg_str)
            if MC_MODE: print_arg_str = f"[grey58]{print_arg_str}[/grey58]"
            self.console.print(f"{self._wrap_timestamp(timestamp, color=True)}\n[bold {colors[2]}]{name}[/bold {colors[2]}]({print_arg_str})")
    def _save_tool_call(self, tool_calls: List, timestamp: str):
        if len(tool_calls) >= 1: self._write_log(self._wrap_title("Tool Calls"))

        for tool_call in tool_calls:
            f = tool_call["function"]
            name, args = f["name"], f["arguments"]
            arg_str = self._warp_args(args)
            self._write_log(f"{self._wrap_timestamp(timestamp, color=False)}\n{name}({arg_str})")

    def pretty_print_messages(self, message, **kwargs) -> None:
        # for message in messages:
        if message["role"] != "assistant" and message["role"] != "tool":
            return
        # console = Console()
        
        # handle tool call
        if message["role"] == "tool":
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if self.log_path: self._save_tool_execution(message, timestamp)
            if self.debug: self._print_tool_execution(message, timestamp)
            return
        
        # handle assistant message
        # print agent name in blue
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if self.log_path: self._save_assistant_message(message, timestamp)
        if self.debug: self._print_assistant_message(message, timestamp)

        # print tool calls in purple, if any
        tool_calls = message.get("tool_calls") or []
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if self.log_path: self._save_tool_call(tool_calls, timestamp)
        if self.debug: self._print_tool_call(tool_calls, timestamp)
class LoggerManager:
    _instance = None
    _logger: MetaChainLogger = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = LoggerManager()
        return cls._instance

    @classmethod
    def get_logger(cls):
        return cls.get_instance()._logger

    @classmethod
    def set_logger(cls, new_logger):
        cls.get_instance()._logger = new_logger
if DEFAULT_LOG:
    if LOG_PATH is None:
        log_dir = Path(f'logs/res_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
        log_dir.mkdir(parents=True, exist_ok=True)  # recursively create all necessary parent directories
        log_path = str(log_dir / "agent.log")
        # logger = MetaChainLogger(log_path=log_path)
        LoggerManager.set_logger(MetaChainLogger(log_path=log_path))
    else:
        # logger = MetaChainLogger(log_path=LOG_PATH)
        LoggerManager.set_logger(MetaChainLogger(log_path=LOG_PATH))
    # logger.info("Log file is saved to", logger.log_path, "...", title="Log Path", color="light_cyan3")
    LoggerManager.get_logger().info("Log file is saved to", 
                                  LoggerManager.get_logger().log_path, "...", 
                                  title="Log Path", color="light_cyan3")
else:
    # logger = None
    LoggerManager.set_logger(None)
logger = LoggerManager.get_logger()

def set_logger(new_logger):
    LoggerManager.set_logger(new_logger)
# if __name__ == "__main__":
#     logger = MetaChainLogger(log_path="test.log")
#     logger.pretty_print_messages({"role": "assistant", "content": "Hello, world!", "tool_calls": [{"function": {"name": "test", "arguments": {"url": "https://www.google.com", "query": "test"}}}], "sender": "test_agent"})

#     logger.pretty_print_messages({"role": "tool", "name": "test", "content": "import requests\n\nurl = 'https://www.google.com'\nquery = 'test'\n\nresponse = requests.get(url)\nprint(response.text)", "sender": "test_agent"})
#     logger.info("test content", color="red", title="test")
