from autoagent import MetaChain, Agent, Response
from typing import List
from autoagent.logger import MetaChainLogger
from autoagent.environment.utils import setup_metachain
from autoagent.environment.docker_env import DockerConfig, DockerEnv

def case_resolved(result: str):
    """
    Use this tool to indicate that the case is resolved. You can use this tool only after you truly resolve the case with exsiting tools and created new tools.Please encapsulate your final answer (answer ONLY) within <solution> and </solution>. 

    Args:
        result: The final result of the case resolution following the instructions.

    Example: case_resolved(`The answer to the question is <solution> 42 </solution>`)
    """
    return f"Case resolved. No further actions are needed. The result of the case resolution is: {result}"

def case_not_resolved(failure_reason: str, take_away_message: str):
    """
    Use this tool to indicate that the case is not resolved when all agents have tried their best.
    [IMPORTANT] Please do not use this function unless all of you have tried your best.
    You should give the failure reason to tell the user why the case is not resolved, and give the take away message to tell which information you gain from creating new tools.

    Args:
        failure_reason: The reason why the case is not resolved.
        take_away_message: The message to take away from the case.
    """
    return f"Case not resolved. The reason is: {failure_reason}. But though creating new tools, I gain some information: {take_away_message}"

async def run_in_client(
    agent: Agent,
    messages: List,
    context_variables: dict = {},
    logger: MetaChainLogger = None,
    meta_agent: Agent = None,
    docker_config: DockerConfig = None,
    code_env: DockerConfig = None,
):
    """
    """
    client = MetaChain(log_path=logger)

    MAX_RETRY = 3
    for i in range(MAX_RETRY):
        try:
            response: Response = await client.run_async(agent, messages, context_variables, debug=True)
        except Exception as e:
            logger.info(f'Exception in main loop: {e}', title='ERROR', color='red')
            raise e
        if 'Case resolved' in response.messages[-1]['content']:
            break
        elif 'Case not resolved' in response.messages[-1]['content']:
            messages.extend(response.messages)
            if meta_agent and (i >= 2):
                setup_metachain(docker_config.workplace_name, code_env)
                messages.append({
                    'role': 'user',
                    'content': """\
It seems that the case is not resolved with the existing agent system.
Help me to solve this problem by running tools in the MetaChain.
IMPORTANT: You should fully take advantage of existing tools, and if existing tools are not enough, you should develop new tools.
Use `visual_question_answering` tool for ALL visual tasks (images, videos, visual analysis, including object detection, etc.)
IMPORTANT: You can not stop with `case_not_resolved` after you try your best to creating new tools.
IMPORTANT: You should ONLY interact with the environment provided to you AND NEVER ASK FOR HUMAN HELP.
Please encapsulate your final answer (answer ONLY) within <solution> and </solution>.
"""
                })
                meta_agent.functions.append(case_not_resolved)
                meta_agent.functions.append(case_resolved)
                response: Response = await client.run_async(meta_agent, messages, context_variables, debug=True)
                if 'Case resolved' in response.messages[-1]['content']:
                    break   
                else: 
                    messages.extend(response.messages)

            messages.append({
                'role': 'user',
                'content': 'Please try to resolve the case again. It\'s important for me to resolve the case. Trying again in another way may be helpful.'
            })

    return response

def run_in_client_non_async(
    agent: Agent,
    messages: List,
    context_variables: dict | None = None,
    logger: MetaChainLogger = None,
):
    """
    """
    if context_variables is None:
        context_variables = {}
    client = MetaChain(log_path=logger)

    MAX_RETRY = 3
    for i in range(MAX_RETRY):
        try:
            response: Response = client.run(agent, messages, context_variables, debug=True)
        except Exception as e:
            logger.info(f'Exception in main loop: {e}', title='ERROR', color='red')
            raise e
        if 'Case resolved' in response.messages[-1]['content']:
            break
        elif 'Case not resolved' in response.messages[-1]['content']:
            messages.extend(response.messages)
            messages.append({
                'role': 'user',
                'content': 'Please try to resolve the case again. It\'s important for me to resolve the case. Trying again in another way may be helpful.'
            })

    return response