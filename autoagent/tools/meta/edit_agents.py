from autoagent.registry import registry
from autoagent.environment import LocalEnv, DockerEnv, DockerConfig
from typing import Union
from autoagent.tools.terminal_tools import (
    create_file, 
    create_directory, 
    execute_command, 
    run_python, 
    print_stream,
    process_terminal_response
    )
from autoagent.registry import register_tool
import json
from autoagent.tools.meta.edit_tools import get_metachain_path
from string import Formatter
from pydantic import BaseModel
import subprocess
import sys
import shlex
from datetime import datetime
@register_tool("list_agents")
def list_agents(context_variables): 
    """
    List all plugin agents in the MetaChain.
    Returns:
        A list of information of all plugin agents including name, args, docstring, body, return_type, file_path.
    """
    env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(env)
    except Exception as e:
        return "[ERROR] Failed to list agents. Error: " + str(e)
    python_code = '"from autoagent.registry import registry; import json; print(\\"AGENT_LIST_START\\"); print(json.dumps(registry.display_plugin_agents_info, indent=4)); print(\\"AGENT_LIST_END\\")"'
    list_agents_cmd = f"cd {path} && DEFAULT_LOG=False python -c {python_code}"
    result = env.run_command(list_agents_cmd)
    if result['status'] != 0:
        return "[ERROR] Failed to list agents. Error: " + result['result']
    try:
        output = result['result']
        start_marker = "AGENT_LIST_START"
        end_marker = "AGENT_LIST_END"
        start_idx = output.find(start_marker) + len(start_marker)
        end_idx = output.find(end_marker)
        
        if start_idx == -1 or end_idx == -1:
            return "[ERROR] Failed to parse agent list: markers not found"
            
        json_str = output[start_idx:end_idx].strip()
        return json_str
    except Exception as e:
        return f"[ERROR] Failed to process output: {str(e)}"


@register_tool("delete_agent")
def delete_agent(agent_name: str, context_variables): 
    """
    Delete a plugin agent.
    Args:
        agent_name: The name of the agent to be deleted.
    Returns:
        A string representation of the result of the agent deletion.
    """
    env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        agent_list = list_agents(context_variables)
        if agent_list.startswith("[ERROR]"):
            return "[ERROR] Failed to list agents. Error: " + agent_list
        agent_dict = json.loads(agent_list)
        if agent_name in agent_dict.keys():
            agent_info = agent_dict[agent_name]
        else: 
            return "[ERROR] The agent " + agent_name + " does not exist."
    except Exception as e:
        return "[ERROR] Before deleting a agent, you should list all agents first. But the following error occurred: " + str(e)
    
    agent_path = agent_info['file_path']
    try:
        result = env.run_command(f"rm {agent_path}")
        if result['status'] != 0:
            return f"[ERROR] Failed to delete agent: `{agent_name}`. Error: " + result['result']
        return f"[SUCCESS] Successfully deleted agent: `{agent_name}`."
    except Exception as e:
        return f"[ERROR] Failed to delete agent: `{agent_name}`. Error: " + str(e)

@register_tool("run_agent")
@process_terminal_response
def run_agent(agent_name: str, query: str, ctx_vars: dict, context_variables, model: str = "claude-3-5-sonnet-20241022"): 
    """
    Run a plugin agent.
    Args:
        agent_name: The name of the agent.
        model: The model to be used for the agent. Supported models: claude-3-5-sonnet-20241022. 
        query: The query to be used for the agent.
        ctx_vars: The global context variables to be used for the agent. It is a dictionary with the key as the variable name and the value as the variable value.
    Returns:
        A string representation of the result of the agent run.
    """
    if model not in ["claude-3-5-sonnet-20241022"]:
        return "[ERROR] The model " + model + " is not supported. Supported models: claude-3-5-sonnet-20241022."
    env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(env)
    except Exception as e:
        return "[ERROR] Failed to get the path of the MetaChain. Error: " + str(e)
    
    try:
        agent_list = list_agents(context_variables)
        if agent_list.startswith("[ERROR]"):
            return "[ERROR] Failed to list agents. Error: " + agent_list
        agent_dict = json.loads(agent_list)
        if agent_name in agent_dict.keys():
            agent_info = agent_dict[agent_name]
            agent_func = agent_info['func_name']
        else: 
            return "[ERROR] The agent " + agent_name + " does not exist."
    except Exception as e:
        return "[ERROR] Before running a agent, you should list all agents first. But the following error occurred: " + str(e)
    if isinstance(ctx_vars, dict) is False:
        try: 
            ctx_vars = json.loads(ctx_vars)
        except Exception as e:
            return "[ERROR] The context variables are not a valid JSON object. Error: " + str(e)

    ctx_vars_str = ""
    for key, value in ctx_vars.items():
        ctx_vars_str += f"{key}={value} "
    try:
        # query = shlex.quote(query)
        # run_cmd = f'cd {path} && DEFAULT_LOG=False mc agent --model={model} --agent_func={agent_func} --query={query} {ctx_vars_str}'
        query = shlex.quote(query)
        shell_content = f"""#!/bin/bash
cd {path}
DEFAULT_LOG=False mc agent --model={model} --agent_func={agent_func} --query={query} {ctx_vars_str}
"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        create_directory(f"{path}/tmp_shell", context_variables)
        create_file(f"{path}/tmp_shell/run_agent_{timestamp}.sh", shell_content, context_variables)
        run_cmd = f"cd {path} && chmod +x tmp_shell/run_agent_{timestamp}.sh && ./tmp_shell/run_agent_{timestamp}.sh"
        result = env.run_command(run_cmd, print_stream)
        # if result['status'] != 0:
        #     return f"[ERROR] Failed to run agent: `{agent_func}`. Error: " + result['result']
        # return f"[SUCCESS] Successfully run agent: `{agent_func}`. The result is: \n{result['result']}"
        return result
    except Exception as e:
        return "[ERROR] Failed to run the agent. Error: " + str(e)

def has_format_keys(s):
    formatter = Formatter()
    return any(tuple_item[1] is not None for tuple_item in formatter.parse(s))
def extract_format_keys(s):
    formatter = Formatter()
    ret_list = []
    for tuple_item in formatter.parse(s):
        if tuple_item[1] is not None and tuple_item[1] not in ret_list:
            ret_list.append(tuple_item[1])
    return ret_list
@register_tool("create_agent")
def create_agent(agent_name: str, agent_description: str, agent_tools: list[str], agent_instructions: str, context_variables):
    """
    Use this tool to create a new agent or modify an existing agent.

    Args:
        agent_name: The name of the agent.
        agent_description: The description of the agent.
        agent_tools: The tools of the agent. The tools MUST be included in the list of given tools.
        agent_instructions: The system instructions of the agent, which tells the agent about the responsibility of the agent, the tools it can use and other important information. It could be a pure string or a string with the format of {global_keys}, where the global keys are the keys of the variables that are given to the agent.

    Returns:
        A string representation of the result of the agent creation or modification.
    """
    tools_str = ""
    code_env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(code_env)
    except Exception as e:
        return "[ERROR] Failed to list agents. Error: " + str(e)
    
    agents_dir = path + "/autoagent/agents"

    for tool in agent_tools:
        tools_str += f"from autoagent.tools import {tool}\n"
    agent_func = f"get_{agent_name.lower().replace(' ', '_')}"
    if has_format_keys(agent_instructions):
        format_keys = extract_format_keys(agent_instructions)
        format_keys_values = []
        for fk in format_keys:
            format_keys_values.append(f"{fk}=context_variables.get('{fk}', '')")
        format_keys_values_str = ", ".join(format_keys_values)
        instructions_str = f"""\
def instructions(context_variables):
        return {repr(agent_instructions)}.format({format_keys_values_str})
"""
    else:
        instructions_str = f"""instructions = {repr(agent_instructions)}"""
    tool_list = "[{}]".format(', '.join(f'{tool}' for tool in agent_tools))

    create_codes = f"""\
from autoagent.types import Agent
{tools_str}
from autoagent.registry import register_plugin_agent

@register_plugin_agent(name="{agent_name}", func_name="{agent_func}")
def {agent_func}(model: str):
    '''
    {agent_description}
    '''
    {instructions_str}
    return Agent(
    name="{agent_name}",
    model=model,
    instructions=instructions,
    functions={tool_list}
    )

"""
    # print(create_codes)
    # with open(f"autoagent/agents/{agent_name.lower().replace(' ', '_')}.py", "w", encoding="utf-8") as f:
    #     f.write(create_codes)
    try:  
        msg = create_file(agents_dir + "/" + agent_name.lower().replace(' ', '_') + ".py", create_codes, context_variables)
        if msg.startswith("Error creating file:"):
            return "[ERROR] Failed to create agent. Error: " + msg
        result = code_env.run_command('cd {} && python autoagent/agents/{}.py'.format(path, agent_name.lower().replace(' ', '_')))
        if result['status'] != 0:
            return "[ERROR] Failed to create agent. Error: " + result['result']
        return "Successfully created agent: " + agent_name + " in " + agents_dir + "/" + agent_name.lower().replace(' ', '_') + ".py"
    except Exception as e:
        return "[ERROR] Failed to create agent. Error: " + str(e)

class SubAgent(BaseModel):
    name: str
    agent_input: str
    agent_output: str
@register_tool("create_orchestrator_agent")
def create_orchestrator_agent(agent_name: str, agent_description: str, sub_agents: list[SubAgent], agent_instructions: str, context_variables):
    """
    Use this tool to create a orchestrator agent for the given sub-agents. You MUST use this tool when you need to create TWO or MORE agents and regard them as a whole to complete a task.

    Args:
        agent_name: The name of the orchestrator agent for the given sub-agents.
        agent_description: The description of the orchestrator agent.
        sub_agents: The list of sub-agents. Each sub-agent contains the name of the sub-agent, the input of the sub-agent and the output of the sub-agent.
        agent_instructions: The system instructions of the orchestrator agent, which tells the agent about the responsibility of the agent (orchestrate the workflow of the given sub-agents), the given sub-agents and other important information. It could be a pure string or a string with the format of {global_keys}, where the global keys are the keys of the variables that are given to the agent.

    Returns:
        A string representation of the result of the agent creation or modification.
    """
    
    code_env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
    try:
        path = get_metachain_path(code_env)
    except Exception as e:
        return "[ERROR] Failed to list agents. Error: " + str(e)
    
    agents_dir = path + "/autoagent/agents"
    agent_list = list_agents(context_variables)
    if agent_list.startswith("[ERROR]"):
        return "Failed to list agents. Error: " + agent_list
    agent_dict = json.loads(agent_list)
    missing = [sa["name"] for sa in sub_agents if sa["name"] not in agent_dict]
    if missing:
        return f"[ERROR] Sub-agent(s) not found in registry: {missing}. Register them first."
    sub_agent_info = [agent_dict[sub_agent["name"]] for sub_agent in sub_agents]
    import_agent_str = ""
    for ainfo in sub_agent_info:
        import_agent_str += f"""
    from autoagent.agents import {ainfo['func_name']}
"""
    if has_format_keys(agent_instructions):
        format_keys = extract_format_keys(agent_instructions)
        format_keys_values = []
        for fk in format_keys:
            format_keys_values.append(f"{fk}=context_variables.get('{fk}', '')")
        format_keys_values_str = ", ".join(format_keys_values)
        instructions_str = f"""\
def instructions(context_variables):
        return {repr(agent_instructions)}.format({format_keys_values_str})
"""
    else:
        instructions_str = f"""instructions = {repr(agent_instructions)}"""
    orchestrator_agent_def = f"""
    {agent_name.lower().replace(' ', '_')} = Agent(
    name="{agent_name}",
    model=model,
    instructions=instructions,
    )
"""
    sub_agent_funcs = [ainfo['func_name'] for ainfo in sub_agent_info]
    get_sub_agents = ""
    transfer_sub_agent_func = ""
    transfer_back_to_orchestrator_func = ""
    transfer_funcs_str = []
    for sub_agent_func, sub_agent in zip(sub_agent_funcs, sub_agents):
        get_sub_agents += f"""
    {sub_agent_func.replace('get_', '')}: Agent = {sub_agent_func}(model)
    {sub_agent_func.replace('get_', '')}.tool_choice = "required"
"""
        transfer_sub_agent_func += f"""
    def transfer_to_{sub_agent_func.replace('get_', '')}({sub_agent["agent_input"]}: str):
        '''
        Use this tool to transfer the request to the `{sub_agent_func.replace('get_', '')}` agent.

        Args:
            {sub_agent["agent_input"]}: the request to be transferred to the `{sub_agent_func.replace('get_', '')}` agent. It should be a string.
        '''
        return Result(value = {sub_agent["agent_input"]}, agent = {sub_agent_func.replace('get_', '')})
"""
        transfer_funcs_str.append(f"transfer_to_{sub_agent_func.replace('get_', '')}")
        transfer_back_to_orchestrator_func += f"""
    def transfer_back_to_{agent_name.lower().replace(' ', '_')}({sub_agent["agent_output"]}: str):
        '''
        Use this tool to transfer the response back to the `{agent_name}` agent. You can only use this tool when you have tried your best to do the task the orchestrator agent assigned to you.

        Args:
            {sub_agent["agent_output"]}: the response to be transferred back to the `{agent_name}` agent. It should be a string.
        '''
        return Result(value = {sub_agent["agent_output"]}, agent = {agent_name.lower().replace(' ', '_')}) 
    {sub_agent_func.replace('get_', '')}.functions.append(transfer_back_to_{agent_name.lower().replace(' ', '_')})
"""
    
    agent_func = f"get_{agent_name.lower().replace(' ', '_')}"
    
    

    create_codes = f"""\
from autoagent.types import Agent
from autoagent.registry import register_plugin_agent
from autoagent.types import Result  

@register_plugin_agent(name = "{agent_name}", func_name="{agent_func}")
def {agent_func}(model: str):
    '''
    {agent_description}
    '''
    {import_agent_str}
    {instructions_str}
    {orchestrator_agent_def}

    {get_sub_agents}
    {transfer_sub_agent_func}
    {transfer_back_to_orchestrator_func}

    {agent_name.lower().replace(' ', '_')}.functions = [{", ".join(transfer_funcs_str)}]
    return {agent_name.lower().replace(' ', '_')}
"""
    # print(create_codes)
    # with open(f"autoagent/agents/{agent_name.lower().replace(' ', '_')}.py", "w", encoding="utf-8") as f:
    #     f.write(create_codes)
    try:  
        msg = create_file(agents_dir + "/" + agent_name.lower().replace(' ', '_') + ".py", create_codes, context_variables)
        if msg.startswith("Error creating file:"):
            return "[ERROR] Failed to create agent. Error: " + msg
        result = code_env.run_command('cd {} && python autoagent/agents/{}.py'.format(path, agent_name.lower().replace(' ', '_')))
        if result['status'] != 0:
            return "[ERROR] Failed to create agent. Error: " + result['result']
        return "Successfully created agent: " + agent_name + " in " + agents_dir + "/" + agent_name.lower().replace(' ', '_') + ".py"
    except Exception as e:
        return "[ERROR] Failed to create agent. Error: " + str(e)

def read_agent(agent_name: str, context_variables: dict):
    try:
        env: Union[LocalEnv, DockerEnv] = context_variables.get("code_env", LocalEnv())
        try:
            path = get_metachain_path(env)
        except Exception as e:
            return "[ERROR] Failed to get the path of the MetaChain. Error: " + str(e)
        agent_list = list_agents(context_variables)
        if agent_list.startswith("[ERROR]"):
            return "Failed to list agents. Error: " + agent_list
        agent_dict = json.loads(agent_list)
        if agent_name not in agent_dict.keys():
            return "[ERROR] The agent " + agent_name + " does not exist."
        agent_info = agent_dict[agent_name]
        ret_val = f"""\
    The information of the agent {agent_name} is:
    {agent_info}
    """
        return ret_val
    except Exception as e:
        return "[ERROR] Failed to read the agent. Error: " + str(e)


if __name__ == "__main__":
#     # print(list_agents({}))
#     from litellm import completion
#     from autoagent.util import function_to_json
#     tools = [function_to_json(create_agent)]
#     messages = [
#         {"role": "system", "content": "You are a helpful assistant."},
#         {"role": "user", "content": """\
# Create an Personalized RAG agent that can answer the question about the given document. There are some tools you can use: 
# - save_raw_docs_to_vector_db: Save the raw documents to the vector database. The documents could be: 
#     - ANY text document with the extension of pdf, docx, txt, etcs.
#     - A zip file containing multiple text documents
#     - a directory containing multiple text documents
#     All documents will be converted to raw text format and saved to the vector database in the chunks of 4096 tokens.
# - query_db: Retrieve information from the database. Use this function when you need to search for information in the database.
# - modify_query: Modify the query based on what you know. Use this function when you need to modify the query to search for more relevant information.
# - answer_query: Answer the user query based on the supporting documents.
# - can_answer: Check if you have enough information to answer the user query.
# - visual_question_answering: This tool is used to answer questions about attached images or videos.

# There are some global variables you can use:
# glbal_keys | global_vals
# -----------|-----------
# user_name | "Jiabin Tang"
# user_email | "jiabin.tang@gmail.com"

# [IMPORTANT] NOT ALL tools are required to be used. You can choose the tools that you think are necessary.
#          """},
#     ]
#     for tool in tools:
#         params = tool["function"]["parameters"]
#         params["properties"].pop("context_variables", None)
#         if "context_variables" in params["required"]:
#             params["required"].remove("context_variables")
#     # response = completion(
#     #     model="claude-3-5-sonnet-20241022",
#     #     messages=messages,
#     #     tools=tools,
#     #     tool_choice="auto",  # auto is default, but we'll be explicit
#     # )
#     # print("\nLLM Response1:\n", response.choices[0].message.tool_calls)
#     # args = json.loads(response.choices[0].message.tool_calls[0].function.arguments)
#     # create_agent(args["agent_name"], args["agent_description"], args["agent_tools"], args["agent_instructions"], {})
#     # print(list_agents({}))
#     print(create_orchestrator_agent("Orchestrator Coding RAG Agent", "An Orchestrator Agent that orchestrates the workflow of the codig agent and the RAG agent.", [{"name": "Personalized RAG Agent", "agent_input": "doc_query", "agent_output": "queried_doc_content"}, {"name": "Coding Agent", "agent_input": "coding_query", "agent_output": "coding_result"}], "You are a helpful assistant.", {}))
    docker_cfg = DockerConfig(
        container_name = "nl2agent_showcase", 
        workplace_name = "workplace", 
        communication_port = 12350, 
        conda_path = "/root/miniconda3",
        local_root = "/Users/tangjiabin/Documents/reasoning/autoagent/workspace_meta_showcase/showcase_nl2agent_showcase"
    )
    code_env = DockerEnv(docker_cfg)
    context_variables = {"code_env": code_env}
    print(run_agent(agent_name='Financial Analysis Orchestrator', query="Based on the 10-K reports of AAPL and MSFT from the past 5 years in the docs directory `docs/aapl-2020-2024-10K/` and `docs/msft-2020-2024-10K/`, along with AAPL's other reports `docs/aapl-other-report/` and available data, conduct a comprehensive horizontal comparison, create a comparative analysis report, and provide constructive investment advice for investing in them in 2025.", ctx_vars='{}', context_variables=context_variables))


