# Standard library imports
import copy
import json
from collections import defaultdict
from typing import List, Callable, Union
from datetime import datetime
# Local imports
import os
from .util import function_to_json, debug_print, merge_chunk, pretty_print_messages
from .types import (
    Agent,
    AgentFunction,
    Message,
    ChatCompletionMessageToolCall,
    Function,
    Response,
    Result,
)
from litellm import completion, acompletion
from pathlib import Path
from .logger import MetaChainLogger, LoggerManager
from httpx import RemoteProtocolError, ConnectError
from litellm.exceptions import APIError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type
)
from openai import AsyncOpenAI
import litellm
import inspect
from constant import MC_MODE, FN_CALL, API_BASE_URL, NOT_SUPPORT_SENDER, ADD_USER, NON_FN_CALL
from constant import OLLAMA_ENABLED, OLLAMA_BASE_URL, OLLAMA_MODEL
from autoagent.tools.ollama_client import OllamaClient
from autoagent.fn_call_converter import convert_tools_to_description, convert_non_fncall_messages_to_fncall_messages, SYSTEM_PROMPT_SUFFIX_TEMPLATE, convert_fn_messages_to_non_fn_messages, interleave_user_into_messages
from litellm.types.utils import Message as litellmMessage
# litellm.set_verbose=True
# client = AsyncOpenAI()
def should_retry_error(exception):
    if MC_MODE is False: print(f"Caught exception: {type(exception).__name__} - {str(exception)}")

    # 匹配更多错误类型
    if isinstance(exception, (APIError, RemoteProtocolError, ConnectError)):
        return True

    # 通过错误消息匹配
    error_msg = str(exception).lower()
    return any([
        "connection error" in error_msg,
        "server disconnected" in error_msg,
        "eof occurred" in error_msg,
        "timeout" in error_msg,
        "event loop is closed" in error_msg,  # 添加事件循环错误
        "anthropicexception" in error_msg,     # 添加 Anthropic 相关错误
    ])
__CTX_VARS_NAME__ = "context_variables"
logger = LoggerManager.get_logger()

def adapt_tools_for_gemini(tools):
    """为 Gemini 模型适配工具定义，确保所有 OBJECT 类型参数都有非空的 properties"""
    if tools is None:
        return None

    adapted_tools = []
    for tool in tools:
        adapted_tool = copy.deepcopy(tool)

        # 检查参数
        if "parameters" in adapted_tool["function"]:
            params = adapted_tool["function"]["parameters"]

            # 处理顶层参数
            if params.get("type") == "object":
                if "properties" not in params or not params["properties"]:
                    params["properties"] = {
                        "dummy": {
                            "type": "string",
                            "description": "Dummy property for Gemini compatibility"
                        }
                    }

            # 处理嵌套参数
            if "properties" in params:
                for prop_name, prop in params["properties"].items():
                    if isinstance(prop, dict) and prop.get("type") == "object":
                        if "properties" not in prop or not prop["properties"]:
                            prop["properties"] = {
                                "dummy": {
                                    "type": "string",
                                    "description": "Dummy property for Gemini compatibility"
                                }
                            }

        adapted_tools.append(adapted_tool)
    return adapted_tools

class MetaChain:
    def __init__(self, log_path: Union[str, None, MetaChainLogger] = None):
        """
        Initialize the MetaChain.

        Args:
            log_path: Path to log file, or instance of MetaChainLogger, or None to disable logging.
        """
        if isinstance(log_path, MetaChainLogger):
            self.logger = log_path
        else:
            self.logger = LoggerManager.get_logger(log_path)

        # Initialize Ollama client if enabled
        self.ollama_enabled = OLLAMA_ENABLED
        if self.ollama_enabled:
            self.ollama_client = OllamaClient(OLLAMA_BASE_URL)
            # Test connection
            models = self.ollama_client.list_models()
            if models['status'] != 0:
                print(f"Warning: Could not connect to Ollama: {models['message']}")
                self.ollama_enabled = False
            else:
                print(f"Successfully connected to Ollama. Available models: {[m['name'] for m in models['models']]}")
    # @retry(
    #     stop=stop_after_attempt(4),
    #     wait=wait_exponential(multiplier=1, min=4, max=60),
    #     retry=should_retry_error,
    #     before_sleep=lambda retry_state: print(f"Retrying... (attempt {retry_state.attempt_number})")
    # )
    def get_chat_completion(
        self,
        agent: Agent,
        history: List,
        context_variables: dict,
        model_override: str,
        stream: bool,
        debug: bool,
    ) -> Message:
        # Modify model selection to check for Ollama
        model = model_override or agent.get("model")

        # Check if we should use Ollama
        if self.ollama_enabled and (model.startswith("ollama/") or model == OLLAMA_MODEL):
            return self._get_ollama_completion(agent, history, model, stream, debug)

        context_variables = defaultdict(str, context_variables)
        instructions = (
            agent.instructions(context_variables)
            if callable(agent.instructions)
            else agent.instructions
        )
        if agent.examples:
            examples = agent.examples(context_variables) if callable(agent.examples) else agent.examples
            history = examples + history

        messages = [{"role": "system", "content": instructions}] + history
        # debug_print(debug, "Getting chat completion for...:", messages)

        tools = [function_to_json(f) for f in agent.functions]
        # hide context_variables from model
        for tool in tools:
            params = tool["function"]["parameters"]
            params["properties"].pop(__CTX_VARS_NAME__, None)
            if __CTX_VARS_NAME__ in params["required"]:
                params["required"].remove(__CTX_VARS_NAME__)
        create_model = model

        if "gemini" in create_model.lower():
            tools = adapt_tools_for_gemini(tools)
        if FN_CALL:
            # create_model = model_override or agent.model
            assert litellm.supports_function_calling(model = create_model) == True, f"Model {create_model} does not support function calling, please set `FN_CALL=False` to use non-function calling mode"
            create_params = {
                "model": create_model,
                "messages": messages,
                "tools": tools or None,
                "tool_choice": agent.tool_choice,
                "stream": stream,
            }
            NO_SENDER_MODE = False
            for not_sender_model in NOT_SUPPORT_SENDER:
                if not_sender_model in create_model:
                    NO_SENDER_MODE = True
                    break

            if NO_SENDER_MODE:
                messages = create_params["messages"]
                for message in messages:
                    if 'sender' in message:
                        del message['sender']
                create_params["messages"] = messages

            if tools and create_params['model'].startswith("gpt"):
                create_params["parallel_tool_calls"] = agent.parallel_tool_calls
            completion_response = completion(**create_params)
        else:
            # create_model = model_override or agent.model
            assert agent.tool_choice == "required", f"Non-function calling mode MUST use tool_choice = 'required' rather than {agent.tool_choice}"
            last_content = messages[-1]["content"]
            tools_description = convert_tools_to_description(tools)
            messages[-1]["content"] = last_content + "\n[IMPORTANT] You MUST use the tools provided to complete the task.\n" + SYSTEM_PROMPT_SUFFIX_TEMPLATE.format(description=tools_description)
            NO_SENDER_MODE = False
            for not_sender_model in NOT_SUPPORT_SENDER:
                if not_sender_model in create_model:
                    NO_SENDER_MODE = True
                    break

            if NO_SENDER_MODE:
                for message in messages:
                    if 'sender' in message:
                        del message['sender']
            if NON_FN_CALL:
                messages = convert_fn_messages_to_non_fn_messages(messages)
            if ADD_USER and messages[-1]["role"] != "user":
                # messages.append({"role": "user", "content": "Please think twice and take the next action according to your previous actions and observations."})
                messages = interleave_user_into_messages(messages)
            create_params = {
                "model": create_model,
                "messages": messages,
                "stream": stream,
                "base_url": API_BASE_URL,
            }
            completion_response = completion(**create_params)
            last_message = [{"role": "assistant", "content": completion_response.choices[0].message.content}]
            converted_message = convert_non_fncall_messages_to_fncall_messages(last_message, tools)
            if "tool_calls" in converted_message[0]:
                converted_tool_calls = [ChatCompletionMessageToolCall(**tool_call) for tool_call in converted_message[0]["tool_calls"]]
            else:
                converted_tool_calls = None
            completion_response.choices[0].message = litellmMessage(content = converted_message[0]["content"], role = "assistant", tool_calls = converted_tool_calls)

        return completion_response

    def _get_ollama_completion(self, agent, history, model, stream, debug):
        """
        Get completion from Ollama

        Args:
            agent: The agent
            history: Conversation history
            model: Model name
            stream: Whether to stream the response
            debug: Whether to print debug information

        Returns:
            Message: The response message
        """
        if debug:
            print(f"Using Ollama for model: {model}")

        # Extract actual model name if using 'ollama/' prefix
        if model.startswith("ollama/"):
            model_name = model[len("ollama/"):]
        else:
            model_name = model

        # Convert history to Ollama format
        ollama_messages = []
        for message in history:
            if message["role"] == "system":
                system_message = message["content"]
            else:
                ollama_messages.append({
                    "role": message["role"],
                    "content": message["content"]
                })

        if debug:
            print(f"Sending to Ollama: {len(ollama_messages)} messages")

        # Use chat API if we have multiple messages, otherwise use generate
        if len(ollama_messages) > 0:
            result = self.ollama_client.chat(
                model=model_name,
                messages=ollama_messages,
                stream=stream,
                temperature=0.7
            )
        else:
            # Only system message, use generate
            result = self.ollama_client.generate(
                model=model_name,
                prompt="",
                system=system_message,
                stream=stream,
                temperature=0.7
            )

        if result["status"] != 0:
            raise Exception(f"Ollama error: {result['message']}")

        if stream:
            # For streaming, return a mock message since we can't stream in this implementation
            return {
                "id": "ollama-response",
                "role": "assistant",
                "content": result["message"]["content"] if "message" in result else result["response"]
            }
        else:
            # For non-streaming, return the completed message
            return {
                "id": "ollama-response",
                "role": "assistant",
                "content": result["message"]["content"] if "message" in result else result["response"]
            }

    def handle_function_result(self, result, debug) -> Result:
        match result:
            case Result() as result:
                return result

            case Agent() as agent:
                return Result(
                    value=json.dumps({"assistant": agent.name}),
                    agent=agent,
                )
            case _:
                try:
                    return Result(value=str(result))
                except Exception as e:
                    error_message = f"Failed to cast response to string: {result}. Make sure agent functions return a string or Result object. Error: {str(e)}"
                    self.logger.info(error_message, title="Handle Function Result Error", color="red")
                    raise TypeError(error_message)

    def handle_tool_calls(
        self,
        tool_calls: List[ChatCompletionMessageToolCall],
        functions: List[AgentFunction],
        context_variables: dict,
        debug: bool,
        handle_mm_func: Callable[[], str] = None,
    ) -> Response:
        function_map = {f.__name__: f for f in functions}
        partial_response = Response(
            messages=[], agent=None, context_variables={})

        for tool_call in tool_calls:
            name = tool_call.function.name
            # handle missing tool case, skip to next tool
            if name not in function_map:
                self.logger.info(f"Tool {name} not found in function map. You are recommended to use `run_tool` to run this tool.", title="Tool Call Error", color="red")
                partial_response.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": name,
                        "content": f"Error: Tool {name} not found. You are recommended to use `run_tool` to run this tool.",
                    }
                )
                continue
            args = json.loads(tool_call.function.arguments)

            # debug_print(
            #     debug, f"Processing tool call: {name} with arguments {args}")
            func = function_map[name]
            # pass context_variables to agent functions
            # if __CTX_VARS_NAME__ in func.__code__.co_varnames:
            #     args[__CTX_VARS_NAME__] = context_variables
            if __CTX_VARS_NAME__ in inspect.signature(func).parameters.keys():
                args[__CTX_VARS_NAME__] = context_variables
            raw_result = function_map[name](**args)

            result: Result = self.handle_function_result(raw_result, debug)

            partial_response.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": name,
                    "content": result.value,
                }
            )
            self.logger.pretty_print_messages(partial_response.messages[-1])
            if result.image:
                assert handle_mm_func, f"handle_mm_func is not provided, but an image is returned by tool call {name}({tool_call.function.arguments})"
                partial_response.messages.append(
                {
                    "role": "user",
                    "content": [
                    # {"type":"text", "text":f"After take last action `{name}({tool_call.function.arguments})`, the image of current page is shown below. Please take next action based on the image, the current state of the page as well as previous actions and observations."},
                    {"type":"text", "text":handle_mm_func(name, tool_call.function.arguments)},
                    {
                    "type":"image_url",
                        "image_url":{
                            "url":f"data:image/png;base64,{result.image}"
                        }
                    }
                ]
                }
                )
            # debug_print(debug, "Tool calling: ", json.dumps(partial_response.messages[-1], indent=4), log_path=log_path, title="Tool Calling", color="green")

            partial_response.context_variables.update(result.context_variables)
            if result.agent:
                partial_response.agent = result.agent

        return partial_response

    def run_and_stream(
        self,
        agent: Agent,
        messages: List,
        context_variables: dict = {},
        model_override: str = None,
        debug: bool = False,
        max_turns: int = float("inf"),
        execute_tools: bool = True,
    ):
        active_agent = agent
        context_variables = copy.deepcopy(context_variables)
        history = copy.deepcopy(messages)
        init_len = len(messages)

        while len(history) - init_len < max_turns:

            message = {
                "content": "",
                "sender": agent.name,
                "role": "assistant",
                "function_call": None,
                "tool_calls": defaultdict(
                    lambda: {
                        "function": {"arguments": "", "name": ""},
                        "id": "",
                        "type": "",
                    }
                ),
            }

            # get completion with current history, agent
            completion = self.get_chat_completion(
                agent=active_agent,
                history=history,
                context_variables=context_variables,
                model_override=model_override,
                stream=True,
                debug=debug,
            )

            yield {"delim": "start"}
            for chunk in completion:
                delta = json.loads(chunk.choices[0].delta.json())
                if delta["role"] == "assistant":
                    delta["sender"] = active_agent.name
                yield delta
                delta.pop("role", None)
                delta.pop("sender", None)
                merge_chunk(message, delta)
            yield {"delim": "end"}

            message["tool_calls"] = list(
                message.get("tool_calls", {}).values())
            if not message["tool_calls"]:
                message["tool_calls"] = None
            debug_print(debug, "Received completion:", message)
            history.append(message)

            if not message["tool_calls"] or not execute_tools:
                debug_print(debug, "Ending turn.")
                break

            # convert tool_calls to objects
            tool_calls = []
            for tool_call in message["tool_calls"]:
                function = Function(
                    arguments=tool_call["function"]["arguments"],
                    name=tool_call["function"]["name"],
                )
                tool_call_object = ChatCompletionMessageToolCall(
                    id=tool_call["id"], function=function, type=tool_call["type"]
                )
                tool_calls.append(tool_call_object)

            # handle function calls, updating context_variables, and switching agents
            partial_response = self.handle_tool_calls(
                tool_calls, active_agent.functions, context_variables, debug
            )
            history.extend(partial_response.messages)
            context_variables.update(partial_response.context_variables)
            if partial_response.agent:
                active_agent = partial_response.agent

        yield {
            "response": Response(
                messages=history[init_len:],
                agent=active_agent,
                context_variables=context_variables,
            )
        }

    def run(
        self,
        agent: Agent,
        messages: List,
        context_variables: dict = {},
        model_override: str = None,
        stream: bool = False,
        debug: bool = True,
        max_turns: int = float("inf"),
        execute_tools: bool = True,
    ) -> Response:
        if stream:
            return self.run_and_stream(
                agent=agent,
                messages=messages,
                context_variables=context_variables,
                model_override=model_override,
                debug=debug,
                max_turns=max_turns,
                execute_tools=execute_tools,
            )
        active_agent = agent
        enter_agent = agent
        context_variables = copy.copy(context_variables)
        history = copy.deepcopy(messages)
        init_len = len(messages)

        self.logger.info("Receiveing the task:", history[-1]['content'], title="Receive Task", color="green")

        while len(history) - init_len < max_turns and active_agent:

            # get completion with current history, agent
            completion = self.get_chat_completion(
                agent=active_agent,
                history=history,
                context_variables=context_variables,
                model_override=model_override,
                stream=stream,
                debug=debug,
            )
            message: Message = completion.choices[0].message
            message.sender = active_agent.name
            # debug_print(debug, "Received completion:", message.model_dump_json(indent=4), log_path=log_path, title="Received Completion", color="blue")
            self.logger.pretty_print_messages(message)
            history.append(
                json.loads(message.model_dump_json())
            )  # to avoid OpenAI types (?)

            # if not message.tool_calls or not execute_tools:
            #     self.logger.info("Ending turn.", title="End Turn", color="red")
            #     break

            if enter_agent.tool_choice != "required":
                if (not message.tool_calls and active_agent.name == enter_agent.name) or not execute_tools:
                    self.logger.info("Ending turn.", title="End Turn", color="red")
                    break
            else:
                if (message.tool_calls and message.tool_calls[0].function.name == "case_resolved") or not execute_tools:
                    self.logger.info("Ending turn with case resolved.", title="End Turn", color="red")
                    partial_response = self.handle_tool_calls(
                        message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                    )
                    history.extend(partial_response.messages)
                    context_variables.update(partial_response.context_variables)
                    break
                elif (message.tool_calls and message.tool_calls[0].function.name == "case_not_resolved") or not execute_tools:
                    self.logger.info("Ending turn with case not resolved.", title="End Turn", color="red")
                    partial_response = self.handle_tool_calls(
                        message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                    )
                    history.extend(partial_response.messages)
                    context_variables.update(partial_response.context_variables)
                    break
                elif (not message.tool_calls) or not execute_tools:
                    self.logger.info("Ending turn with no tool calls.", title="End Turn", color="red")
                    break

            # if (message.tool_calls and message.tool_calls[0].function.name == "case_resolved") or not execute_tools:
            #     debug_print(debug, "Ending turn.", log_path=log_path, title="End Turn", color="red")
            #     break

            # handle function calls, updating context_variables, and switching agents
            if message.tool_calls:
                partial_response = self.handle_tool_calls(
                    message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                )
            else:
                partial_response = Response(messages=[message])
            history.extend(partial_response.messages)
            context_variables.update(partial_response.context_variables)
            if partial_response.agent:
                active_agent = partial_response.agent

        return Response(
            messages=history[init_len:],
            agent=active_agent,
            context_variables=context_variables,
        )
    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=10, max=180),
        retry=should_retry_error,
        before_sleep=lambda retry_state: print(f"Retrying... (attempt {retry_state.attempt_number})")
    )
    async def get_chat_completion_async(
        self,
        agent: Agent,
        history: List,
        context_variables: dict,
        model_override: str,
        stream: bool,
        debug: bool,
    ) -> Message:
        context_variables = defaultdict(str, context_variables)
        instructions = (
            agent.instructions(context_variables)
            if callable(agent.instructions)
            else agent.instructions
        )
        if agent.examples:
            examples = agent.examples(context_variables) if callable(agent.examples) else agent.examples
            history = examples + history

        messages = [{"role": "system", "content": instructions}] + history
        # debug_print(debug, "Getting chat completion for...:", messages)

        tools = [function_to_json(f) for f in agent.functions]
        # hide context_variables from model
        for tool in tools:
            params = tool["function"]["parameters"]
            params["properties"].pop(__CTX_VARS_NAME__, None)
            if __CTX_VARS_NAME__ in params["required"]:
                params["required"].remove(__CTX_VARS_NAME__)

        if FN_CALL:
            create_model = model_override or agent.model
            assert litellm.supports_function_calling(model = create_model) == True, f"Model {create_model} does not support function calling, please set `FN_CALL=False` to use non-function calling mode"

            create_params = {
                "model": create_model,
                "messages": messages,
                "tools": tools or None,
                "tool_choice": agent.tool_choice,
                "stream": stream,
            }
            NO_SENDER_MODE = False
            for not_sender_model in NOT_SUPPORT_SENDER:
                if not_sender_model in create_model:
                    NO_SENDER_MODE = True
                    break

            if NO_SENDER_MODE:
                messages = create_params["messages"]
                for message in messages:
                    if 'sender' in message:
                        del message['sender']
                create_params["messages"] = messages

            if tools and create_params['model'].startswith("gpt"):
                create_params["parallel_tool_calls"] = agent.parallel_tool_calls
            completion_response = await acompletion(**create_params)
        else:
            create_model = model_override or agent.model
            assert agent.tool_choice == "required", f"Non-function calling mode MUST use tool_choice = 'required' rather than {agent.tool_choice}"
            last_content = messages[-1]["content"]
            tools_description = convert_tools_to_description(tools)
            messages[-1]["content"] = last_content + "\n[IMPORTANT] You MUST use the tools provided to complete the task.\n" + SYSTEM_PROMPT_SUFFIX_TEMPLATE.format(description=tools_description)
            NO_SENDER_MODE = False
            for not_sender_model in NOT_SUPPORT_SENDER:
                if not_sender_model in create_model:
                    NO_SENDER_MODE = True
                    break

            if NO_SENDER_MODE:
                for message in messages:
                    if 'sender' in message:
                        del message['sender']
            create_params = {
                "model": create_model,
                "messages": messages,
                "stream": stream,
                "base_url": API_BASE_URL,
            }
            completion_response = await acompletion(**create_params)
            last_message = [{"role": "assistant", "content": completion_response.choices[0].message.content}]
            converted_message = convert_non_fncall_messages_to_fncall_messages(last_message, tools)
            converted_tool_calls = [ChatCompletionMessageToolCall(**tool_call) for tool_call in converted_message[0]["tool_calls"]]
            completion_response.choices[0].message = litellmMessage(content = converted_message[0]["content"], role = "assistant", tool_calls = converted_tool_calls)

        # response = await acompletion(**create_params)
        # response = await client.chat.completions.create(**create_params)
        return completion_response

    async def run_async(
        self,
        agent: Agent,
        messages: List,
        context_variables: dict = {},
        model_override: str = None,
        stream: bool = False,
        debug: bool = True,
        max_turns: int = float("inf"),
        execute_tools: bool = True,
    ) -> Response:
        assert stream == False, "Async run does not support stream"
        active_agent = agent
        enter_agent = agent
        context_variables = copy.copy(context_variables)
        history = copy.deepcopy(messages)
        init_len = len(messages)

        self.logger.info("Receiveing the task:", history[-1]['content'], title="Receive Task", color="green")

        while len(history) - init_len < max_turns and active_agent:

            # get completion with current history, agent
            completion = await self.get_chat_completion_async(
                agent=active_agent,
                history=history,
                context_variables=context_variables,
                model_override=model_override,
                stream=stream,
                debug=debug,
            )
            message: Message = completion.choices[0].message
            message.sender = active_agent.name
            # debug_print(debug, "Received completion:", message.model_dump_json(indent=4), log_path=log_path, title="Received Completion", color="blue")
            self.logger.pretty_print_messages(message)
            history.append(
                json.loads(message.model_dump_json())
            )  # to avoid OpenAI types (?)

            if enter_agent.tool_choice != "required":
                if (not message.tool_calls and active_agent.name == enter_agent.name) or not execute_tools:
                    self.logger.info("Ending turn.", title="End Turn", color="red")
                    break
            else:
                if (message.tool_calls and message.tool_calls[0].function.name == "case_resolved") or not execute_tools:
                    self.logger.info("Ending turn with case resolved.", title="End Turn", color="red")
                    partial_response = self.handle_tool_calls(
                        message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                    )
                    history.extend(partial_response.messages)
                    context_variables.update(partial_response.context_variables)
                    break
                elif (message.tool_calls and message.tool_calls[0].function.name == "case_not_resolved") or not execute_tools:
                    self.logger.info("Ending turn with case not resolved.", title="End Turn", color="red")
                    partial_response = self.handle_tool_calls(
                        message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                    )
                    history.extend(partial_response.messages)
                    context_variables.update(partial_response.context_variables)
                    break
                elif (not message.tool_calls) or not execute_tools:
                    self.logger.info("Ending turn with no tool calls.", title="End Turn", color="red")
                    break

            # if (message.tool_calls and message.tool_calls[0].function.name == "case_resolved") or not execute_tools:
            #     debug_print(debug, "Ending turn.", log_path=log_path, title="End Turn", color="red")
            #     break

            # handle function calls, updating context_variables, and switching agents
            if message.tool_calls:
                partial_response = self.handle_tool_calls(
                    message.tool_calls, active_agent.functions, context_variables, debug, handle_mm_func=active_agent.handle_mm_func
                )
            else:
                partial_response = Response(messages=[message])
            history.extend(partial_response.messages)
            context_variables.update(partial_response.context_variables)
            if partial_response.agent:
                active_agent = partial_response.agent

        return Response(
            messages=history[init_len:],
            agent=active_agent,
            context_variables=context_variables,
        )
