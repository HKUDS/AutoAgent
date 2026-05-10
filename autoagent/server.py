import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from pydantic import BaseModel

from autoagent import MetaChain
from autoagent.registry import registry
from autoagent.types import Agent, Response
import inspect


def api_token() -> str:
    token = os.environ.get("AUTOAGENT_API_TOKEN", "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AUTOAGENT_API_TOKEN must be set before using the API server",
        )
    return token


async def require_api_token(request: Request, token: str = Depends(api_token)) -> None:
    auth = request.headers.get("authorization", "").strip()
    prefix = "Bearer "
    if not auth.startswith(prefix) or auth[len(prefix) :].strip() != token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="valid bearer token required")


# 定义lifespan上下文管理器
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时执行
    await create_agent_endpoints(app)
    yield
    # 关闭时执行
    # 清理代码（如果需要）


app = FastAPI(title="MetaChain API", lifespan=lifespan, dependencies=[Depends(require_api_token)])


class ToolRequest(BaseModel):
    args: Dict[str, Any]


class AgentRequest(BaseModel):
    model: str
    query: str
    context_variables: Optional[Dict[str, Any]] = {}


class Message(BaseModel):
    role: str
    content: str


class AgentResponse(BaseModel):
    result: str
    messages: List
    agent_name: str


@app.get("/health", dependencies=[])
async def health():
    return {"status": "ok"}


# 为所有注册的tools创建endpoints
@app.on_event("startup")
def create_tool_endpoints():
    for tool_name, tool_func in registry.tools.items():
        # 创建动态的POST endpoint
        async def create_tool_endpoint(request: ToolRequest, func=tool_func):
            try:
                # 检查必需参数
                sig = inspect.signature(func)
                required_params = {
                    name for name, param in sig.parameters.items()
                    if param.default == inspect.Parameter.empty
                }

                # 验证是否提供了所有必需参数
                if not all(param in request.args for param in required_params):
                    missing = required_params - request.args.keys()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing required parameters: {missing}"
                    )

                result = func(**request.args)
                return {"status": "success", "result": result}
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        # 添加endpoint到FastAPI应用
        endpoint = create_tool_endpoint
        endpoint.__name__ = f"tool_{tool_name}"
        app.post(f"/tools/{tool_name}")(endpoint)


# 重写agent endpoints创建逻辑
@app.on_event("startup")
def create_agent_endpoints():
    for agent_name, agent_func in registry.agents.items():
        async def create_agent_endpoint(
            request: AgentRequest,
            func=agent_func
        ) -> AgentResponse:
            try:
                # 创建agent实例
                agent = func(model=request.model)

                # 创建MetaChain实例
                mc = MetaChain()

                # 构建messages
                messages = [
                    {"role": "user", "content": request.query}
                ]

                # 运行agent
                response = mc.run(
                    agent=agent,
                    messages=messages,
                    context_storage=request.context_variables,
                    debug=True
                )

                return AgentResponse(
                    result=response.messages[-1]['content'],
                    messages=response.messages,
                    agent_name=agent.name
                )

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Agent execution failed: {str(e)}"
                )

        endpoint = create_agent_endpoint
        endpoint.__name__ = f"agent_{agent_name}"
        app.post(f"/agents/{agent_name}/run")(endpoint)


# 获取所有可用的agents信息
@app.get("/agents")
async def list_agents():
    return {
        name: {
            "docstring": info.docstring,
            "args": info.args,
            "file_path": info.file_path
        }
        for name, info in registry.agents_info.items()
    }


# 获取特定agent的详细信息
@app.get("/agents/{agent_name}")
async def get_agent_info(agent_name: str):
    if agent_name not in registry.agents_info:
        raise HTTPException(
            status_code=404,
            detail=f"Agent {agent_name} not found"
        )

    info = registry.agents_info[agent_name]
    return {
        "name": agent_name,
        "docstring": info.docstring,
        "args": info.args,
        "file_path": info.file_path
    }


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("AUTOAGENT_API_HOST", "127.0.0.1")
    port = int(os.environ.get("AUTOAGENT_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
