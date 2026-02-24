from typing import Union
from autoagent.environment import LocalEnv, DockerEnv
from autoagent.tools.meta.edit_tools import get_metachain_path
from autoagent.tools.meta.edit_agents import list_agents
from autoagent.tools.terminal_tools import create_file, create_directory, print_stream, process_terminal_response
from autoagent.registry import register_tool
import json
from autoagent import MetaChain
from autoagent.types import Response
import shlex
from datetime import datetime
from pydantic import BaseModel
CODE_PREFIX = """\
import asyncio
import json
import argparse
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageToolCall
from autoagent.flow import default_drive, EventInput, ReturnBehavior
from autoagent.flow.dynamic import goto_events, abort_this
import re
from autoagent import MetaChain
from autoagent.types import Response
from autoagent.registry import register_workflow

def extract_answer(response: str, key: str):
    pattern = f"<{key}>(.*?)</{key}>"
    matches = re.findall(pattern, response, re.DOTALL)
    return matches[0] if len(matches) > 0 else None
"""


CODE_MAIN = """
@register_workflow(name = '{workflow_name}')
async def {workflow_name}(system_input: str):
    storage_results = dict({input_key} = system_input)
    await default_drive.invoke_event(
        on_start,
        global_ctx=storage_results,
    )
    system_output = storage_results.get({output_key}, None)
    return system_output
"""

EVENT_TEMPLATE_PREFIX = """\
@default_drive.{event_method}
async def {event_name}(event: EventInput, global_ctx):
    inputs = {inputs}
    input_dict = dict()
    for inp in inputs: 
        input_dict[inp["key"]] = global_ctx.get(inp["key"], None)
    
    messages = global_ctx.get('messages', [])
    task = {task}
    outputs = {output_list}
    agent = {agent_func_name}({model})
    
"""
EVENT_TEMPLATE_FIX = r"""
    input_str = []
    for key, value in input_dict.items():
        input_str.append(f"The {key.replace('_', ' ')} is {value}")
    input_str = "\n".join(input_str) + "\n"
    query = input_str + '.\nThe task is: ' + task + '.\n'
"""

# QUERY_TEMPLATE = """\
#     query = input_str + '.\\nThe task is: ' + task + '.\\n'
# """

START_EVENT_CODE = """\
@default_drive.make_event
async def on_start(event: EventInput, global_ctx):
    print("start the workflow:" + {workflow_name})
"""




IF_ELSE_SUFFIX = \
"""
You should follow the above instructions, and return the result in the following format:
"""

EVENT_TEMPLATE_SUFFIX = """\
    messages.append({
        "role": "user",
        "content": query
    })
    client = MetaChain()
    response: Response = await client.run_async(agent = agent, messages = messages, context_variables = global_ctx, debug = True)
    result = response.messages[-1]["content"]
    messages.extend(response.messages)
    global_ctx["messages"] = messages

    for output in outputs:
        ans = extract_answer(result, output["key"])
        if ans:
            if output["action"]["type"] == "RESULT":
                global_ctx[output["key"]] = ans
                return ans
            elif output["action"]["type"] == "ABORT":
                return abort_this()
            elif output["action"]["type"] == "GO_TO":
                return goto_events([output["action"]["value"]])
        elif len(outputs) == 1: 
            global_ctx[output["key"]] = result
            return result
    raise Exception("No valid answer found")
"""


def start_event_to_code(workflow_name: str) -> str:
    """
    Convert the start event to code.
    """
    return START_EVENT_CODE.format(workflow_name = repr(workflow_name))

def single_event_to_code(event: dict, agent_info_dict: dict) -> str:
    """
    Convert a single event to code.

    A event contains:
    - name (str): the name of the event
    - input (dict): the input to the event
    - task (str): the task to perform
    - outputs (list[dict]): the outputs to the event
    - listen (list[str]): the listen to the event
    - agent (dict): the agent to run
    """
    if event["listen"] is None or len(event["listen"]) == 0:
        event_method = "make_event"
    else: 
        event_method = "listen_group([{}])".format(", ".join(event["listen"]))
    inputs = event["inputs"]

    event_code = EVENT_TEMPLATE_PREFIX.format(event_method = event_method, event_name = event["name"], inputs = inputs, task = repr(event["task"]), output_list = event["outputs"], agent_mode_name = agent_info_dict[event["agent"]["name"]]["mode_name"], agent_func_name = agent_info_dict[event["agent"]["name"]]["func_name"], model = repr(event["agent"]["model"])) + EVENT_TEMPLATE_FIX

    if len(event["outputs"]) > 1: 
        condition_str = []
        for output in event["outputs"]:
            condition_str.append(f"If {output['condition']}, then encapsulate your final answer (answer ONLY) within <{output['key']}> and </{output['key']}>. ")
        query_suffix = "\n".join(condition_str)
        query_suffix = f"""
    query_suffix = {repr(IF_ELSE_SUFFIX)}
    query_suffix += {repr(query_suffix)}
    query += query_suffix
"""
        event_code += query_suffix + EVENT_TEMPLATE_SUFFIX
    else:
        event_code += EVENT_TEMPLATE_SUFFIX

    return event_code

@register_tool("create_workflow")
def create_workflow(workflow_name: str, context_variables: dict) -> str:
    workflow_form = context_variables.get("workflow_form", None)
    if workflow_form is None:
        return "Failed to get workflow form. Please provide a workflow form."
    workflow_form = workflow_form.model_dump() if isinstance(workflow_form, BaseModel) else workflow_form
    assert workflow_name == workflow_form['name'], "The workflow name must be the same as the name in the workflow form."
    system_input = workflow_form['system_input']
    system_output = workflow_form['system_output']
    code_env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(code_env)
    except Exception as e:
        return "[ERROR] Failed to list agents. Error: " + str(e)
    
    workflows_dir = path + "/autoagent/workflows"
    agent_list = list_agents(context_variables)
    if agent_list.startswith("[ERROR]"):
        return "Failed to list agents. Error: " + agent_list
    agent_dict = json.loads(agent_list)
    agent_info_dict = {}
    workflow_name = workflow_form["name"]
    for a in workflow_form["agents"]:
        agent_info_dict[a["name"]] = {"name": a["name"], "func_name": agent_dict[a["name"]]["func_name"], "mode_name": a["name"].replace(" ", "_").lower()}

    import_agent_str = ""
    for ainfo in agent_info_dict.values():
        import_agent_str += f"""
from autoagent.agents import {ainfo['func_name']}
"""
    events = workflow_form["events"]
    events_code = CODE_PREFIX + import_agent_str
    for event in events:
        if event["name"] == "on_start":
            events_code += start_event_to_code(workflow_name)
        else:
            events_code += single_event_to_code(event, agent_info_dict)
    

    events_code += CODE_MAIN.format(workflow_name = workflow_name, input_key = system_input["key"], output_key = repr(system_output["key"]))

    try:  
        msg = create_file(workflows_dir + "/" + workflow_name.lower().replace(' ', '_') + "_flow.py", events_code, context_variables)
        if msg.startswith("Error creating file:"):
            return "[ERROR] Failed to create workflow. Error: " + msg
        result = code_env.run_command('cd {} && python autoagent/workflows/{}_flow.py'.format(path, workflow_name.lower().replace(' ', '_')))
        if result['status'] != 0:
            return "[ERROR] Failed to create workflow. Error: " + result['result']
        return "Successfully created workflow: " + workflow_name + " in " + workflows_dir + "/" + workflow_name.lower().replace(' ', '_') + "_flow.py"
    except Exception as e:
        return "[ERROR] Failed to create workflow. Error: " + str(e)

@register_tool("list_workflows")
def list_workflows(context_variables): 
    """
    List all workflows in the MetaChain.
    Returns:
        A list of information of all workflows including name, args, docstring, body, return_type, file_path.
    """
    env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(env)
    except Exception as e:
        return "[ERROR] Failed to list workflows. Error: " + str(e)
    python_code = '"from autoagent.registry import registry; import json; print(\\"WORKFLOW_LIST_START\\"); print(json.dumps(registry.display_workflows_info, indent=4)); print(\\"WORKFLOW_LIST_END\\")"'
    list_workflows_cmd = f"cd {path} && DEFAULT_LOG=False python -c {python_code}"
    result = env.run_command(list_workflows_cmd)
    if result['status'] != 0:
        return "[ERROR] Failed to list workflows. Error: " + result['result']
    try:
        output = result['result']
        start_marker = "WORKFLOW_LIST_START"
        end_marker = "WORKFLOW_LIST_END"
        start_idx = output.find(start_marker) + len(start_marker)
        end_idx = output.find(end_marker)
        
        if start_idx == -1 or end_idx == -1:
            return "[ERROR] Failed to parse workflow list: markers not found"
            
        json_str = output[start_idx:end_idx].strip()
        return json_str
    except Exception as e:
        return f"[ERROR] Failed to process output: {str(e)}"

@register_tool("run_workflow")
@process_terminal_response
def run_workflow(workflow_name: str, system_input: str, context_variables: dict) -> str:
    env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(env)
    except Exception as e:
        return "[ERROR] Failed to get the path of the MetaChain. Error: " + str(e)
    try:
        workflow_list = list_workflows(context_variables)
        if workflow_list.startswith("[ERROR]"):
            return "[ERROR] Failed to list workflows. Error: " + workflow_list
        workflow_dict = json.loads(workflow_list)
        if workflow_name in workflow_dict.keys():
            workflow_info = workflow_dict[workflow_name]
            workflow_func = workflow_info['func_name']
        else: 
            return "[ERROR] The workflow " + workflow_name + " does not exist."
    except Exception as e:
        return "[ERROR] Before running a agent, you should list all agents first. But the following error occurred: " + str(e)
    
    try:
        # query = shlex.quote(query)
        # run_cmd = f'cd {path} && DEFAULT_LOG=False mc agent --model={model} --agent_func={agent_func} --query={query} {ctx_vars_str}'
        system_input = shlex.quote(system_input)
        # timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # create_directory(f"{path}/tmp_input", context_variables)
        # input_file = f"{path}/tmp_input/input_{timestamp}.txt"
        # create_file(input_file, system_input, context_variables)
        shell_content = f"""#!/bin/bash
cd {path}
DEFAULT_LOG=False mc workflow --workflow_name={workflow_name} --system_input={system_input}
"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        create_directory(f"{path}/tmp_shell", context_variables)
        create_file(f"{path}/tmp_shell/run_workflow_{timestamp}.sh", shell_content, context_variables)
        run_cmd = f"cd {path} && chmod +x tmp_shell/run_workflow_{timestamp}.sh && ./tmp_shell/run_workflow_{timestamp}.sh"
        result = env.run_command(run_cmd, print_stream)
        return result
    except Exception as e:
        return "[ERROR] Failed to run the workflow. Error: " + str(e)

if __name__ == "__main__":
    from autoagent.environment import DockerConfig, DockerEnv, LocalEnv
    docker_cfg = DockerConfig(
        container_name = "nl2agent_showcase", 
        workplace_name = "workplace", 
        communication_port = 12350, 
        conda_path = "/root/miniconda3",
        local_root = "/Users/tangjiabin/Documents/reasoning/autoagent/workspace_meta_showcase/showcase_nl2agent_showcase"
    )
    code_env = DockerEnv(docker_cfg)
    with open("/Users/tangjiabin/Documents/reasoning/autoagent/autoagent/agents/meta_agent/workflow_form/condition_mining.json", 'r', encoding='utf-8') as f:
        workflow_form = json.load(f)
    print(workflow_form)
    
    context_variables = {"workflow_form": workflow_form, "code_env": code_env}
    result = create_workflow(workflow_form["name"], context_variables)
    print(result)
    
    result = run_workflow(workflow_form["name"], 'The wheel shown is spun twice, so that the numbers indicated by the pointer are randomly determined (with each number on the wheel being equally likely). The two numbers determined in this way are recorded. The first number is divided by 4, determining one of the remainders 1,2,3 marking the columns of the checkerboard shown. The second number is divided by 5, determining one of the remainders 1,2,3,4 marking the rows of the checkerboard. Finally, a checker is placed on the square where this column and row meet. What is the probability that the checker is placed on a shaded square of the checkerboard? [asy] unitsize(1cm); draw(Circle((0,0),2),linewidth(0.7)); draw((1.7,1)--(-1.7,-1),linewidth(0.7)); draw((1.7,-1)--(-1.7,1),linewidth(0.7)); draw((0,2)--(0,-2)); label("1",(0.8,0.5),NW); label("2",(0.8,-0.5),SW); label("6",(-0.8,0.5),NE); label("9",(-0.8,-0.5),SE); label("3",(-0.7,0),W); label("7",(0.7,0),E); draw((-2.8,0)--(-2.1,0),Arrow); label("Pointer",(-2.8,0),W); fill((3,0)--(3,1)--(4,1)--(4,0)--cycle,gray(0.7)); fill((3,-2)--(3,-1)--(4,-1)--(4,-2)--cycle,gray(0.7)); fill((4,1)--(4,2)--(5,2)--(5,1)--cycle,gray(0.7)); fill((4,-1)--(4,0)--(5,0)--(5,-1)--cycle,gray(0.7)); fill((5,0)--(5,1)--(6,1)--(6,0)--cycle,gray(0.7)); fill((5,-2)--(5,-1)--(6,-1)--(6,-2)--cycle,gray(0.7)); draw((3,-2)--(3,2)--(6,2)--(6,-2)--cycle,linewidth(0.7)); draw((3,-1)--(6,-1),linewidth(0.7)); draw((3,0)--(6,0),linewidth(0.7)); draw((3,1)--(6,1),linewidth(0.7)); draw((4,-2)--(4,2),linewidth(0.7)); draw((5,-2)--(5,2),linewidth(0.7)); label("1",(3.5,-2),S); label("2",(4.5,-2),S); label("3",(5.5,-2),S); label("1",(3,-1.5),W); label("2",(3,-0.5),W); label("3",(3,0.5),W); label("4",(3,1.5),W); [/asy]', context_variables)
    print(result)
    