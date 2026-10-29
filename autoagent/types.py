from litellm.types.utils import ChatCompletionMessageToolCall, Function, Message
from typing import List, Callable, Union, Optional, Tuple, Dict

# Third-party imports
from pydantic import BaseModel, field_validator
import base64
import binascii

AgentFunction = Callable[[], Union[str, "Agent", dict]]


class Agent(BaseModel):
    name: str = "Agent"
    model: str = "gpt-4o"
    instructions: Union[str, Callable[[], str]] = "You are a helpful agent."
    functions: List[AgentFunction] = []
    tool_choice: str = None
    parallel_tool_calls: bool = False
    examples: Union[List[Tuple[dict, str]], Callable[[], str]] = []
    handle_mm_func: Callable[[], str] = None
    agent_teams: Dict[str, Callable] = {}


class Response(BaseModel):
    messages: List = []
    agent: Optional[Agent] = None
    context_variables: dict = {}


class Result(BaseModel):
    """
    Encapsulates the possible return values for an agent function.

    Attributes:
        value (str): The result value as a string.
        agent (Agent): The agent instance, if applicable.
        context_variables (dict): A dictionary of context variables.
    """

    value: str = ""
    agent: Optional[Agent] = None
    context_variables: dict = {}
    image: Optional[str] = None # base64 encoded image

    @field_validator("image")
    @classmethod
    def _validate_image_base64(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            base64.b64decode(v, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("image must be a base64 encoded string") from exc
        return v

    def to_dict(self) -> dict:
        d = {
            "value": self.value,
            "context_variables": self.context_variables,
        }
        if self.agent is not None:
            d["agent"] = self.agent.name
        if self.image is not None:
            d["image"] = self.image
        return d
