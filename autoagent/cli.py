import click
import importlib
from autoagent import MetaChain
from autoagent.util import debug_print
import asyncio
from constant import DOCKER_WORKPLACE_NAME
from autoagent.io_utils import read_yaml_file, get_md5_hash_bytext, read_file
from autoagent.environment.utils import setup_metachain
from autoagent.types import Response
from autoagent import MetaChain
from autoagent.util import ask_text, single_select_menu, print_markdown, debug_print, UserCompleter
from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.styles import Style
from rich.progress import Progress, SpinnerColumn, TextColumn
import json
import argparse
from datetime import datetime
from autoagent.agents.meta_agent import tool_editor, agent_editor
from autoagent.tools.meta.edit_tools import list_tools
from autoagent.tools.meta.edit_agents import list_agents
from loop_utils.font_page import MC_LOGO, version_table, NOTES, GOODBYE_LOGO
from rich.live import Live
from autoagent.environment.docker_env import DockerEnv, DockerConfig, check_container_ports
from autoagent.environment.local_env import LocalEnv
from autoagent.environment.browser_env import BrowserEnv
from autoagent.environment.markdown_browser import RequestsMarkdownBrowser
from evaluation.utils import update_progress, check_port_available, run_evaluation, clean_msg
import os
import os.path as osp
from autoagent.agents import get_system_triage_agent
from autoagent.logger import LoggerManager, MetaChainLogger 
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table
from rich.columns import Columns
from rich.text import Text
from rich.panel import Panel
import re
from autoagent.cli_utils.metachain_meta_agent import meta_agent
from autoagent.cli_utils.metachain_meta_workflow import meta_workflow
from autoagent.cli_utils.file_select import select_and_copy_files
from evaluation.utils import update_progress, check_port_available, run_evaluation, clean_msg
from constant import COMPLETION_MODEL
@click.group()
def cli():
    """The command line interface for autoagent"""
    pass

@cli.command()
@click.option('--model', default='gpt-4o-2024-08-06', help='the name of the model')
@click.option('--agent_func', default='get_dummy_agent', help='the function to get the agent')
@click.option('--query', default='...', help='the user query to the agent')
@click.argument('context_variables', nargs=-1)
def agent(model: str, agent_func: str, query: str, context_variables):
    """
    Run an agent with a given model, agent function, query, and context variables.
    Args:
        model (str): The name of the model.
        agent_func (str): The function to get the agent.
        query (str): The user query to the agent.
        context_variables (list): The context variables to pass to the agent.
    Usage:
        mc agent --model=gpt-4o-2024-08-06 --agent_func=get_weather_agent --query="What is the weather in Tokyo?" city=Tokyo unit=C timestamp=2024-01-01
    """ 
    context_storage = {}
    for arg in context_variables:
        if '=' in arg:
            key, value = arg.split('=', 1)
            context_storage[key] = value
    agent_module = importlib.import_module(f'autoagent.agents')
    try:
        agent_func = getattr(agent_module, agent_func)
    except AttributeError:
        raise ValueError(f'Agent function {agent_func} not found, you shoud check in the `autoagent.agents` directory for the correct function name')
    agent = agent_func(model)
    mc = MetaChain()
    messages = [
        {"role": "user", "content": query}
    ]
    response = mc.run(agent, messages, context_storage, debug=True)
    debug_print(True, response.messages[-1]['content'], title = f'Result of running {agent.name} agent', color = 'pink3')
    return response.messages[-1]['content']

@cli.command()
@click.option('--workflow_name', default=None, help='the name of the workflow')
@click.option('--system_input', default='...', help='the user query to the agent')
def workflow(workflow_name: str, system_input: str):
    """命令行函数的同步包装器"""
    return asyncio.run(async_workflow(workflow_name, system_input))

async def async_workflow(workflow_name: str, system_input: str):
    """异步实现的workflow函数"""
    workflow_module = importlib.import_module(f'autoagent.workflows')
    try:
        workflow_func = getattr(workflow_module, workflow_name)
    except AttributeError:
        raise ValueError(f'Workflow function {workflow_name} not found...')
    
    result = await workflow_func(system_input)  # 使用 await 等待异步函数完成
    debug_print(True, result, title=f'Result of running {workflow_name} workflow', color='pink3')
    return result

def clear_screen():
    console = Console()
    console.print("[bold green]Coming soon...[/bold green]")
    print('\033[u\033[J\033[?25h', end='')  # Restore cursor and clear everything after it, show cursor
def get_config(container_name, port, test_pull_name="main", git_clone=False):
    container_name = container_name
    
    port_info = check_container_ports(container_name)
    if port_info:
        port = port_info[0]
    else:
        # while not check_port_available(port):
        #     port += 1
        # 使用文件锁来确保端口分配的原子性
        import filelock
        lock_file = os.path.join(os.getcwd(), ".port_lock")
        lock = filelock.FileLock(lock_file)
        
        with lock:
            port = port
            while not check_port_available(port):
                port += 1
                print(f'{port} is not available, trying {port+1}')
            # 立即标记该端口为已使用
            with open(os.path.join(os.getcwd(), f".port_{port}"), 'w') as f:
                f.write(container_name)
    local_root = os.path.join(os.getcwd(), f"workspace_meta_showcase", f"showcase_{container_name}")
    os.makedirs(local_root, exist_ok=True)
    docker_config = DockerConfig(
        workplace_name=DOCKER_WORKPLACE_NAME,
        container_name=container_name,
        communication_port=port,
        conda_path='/root/miniconda3',
        local_root=local_root,
        test_pull_name=test_pull_name,
        git_clone=git_clone
    )
    return docker_config
def create_environment(docker_config: DockerConfig):
    """
    1. create the code environment
    2. create the web environment
    3. create the file environment
    """
    code_env = DockerEnv(docker_config)
    code_env.init_container()
    
    web_env = BrowserEnv(browsergym_eval_env = None, local_root=docker_config.local_root, workplace_name=docker_config.workplace_name)
    file_env = RequestsMarkdownBrowser(viewport_size=1024 * 5, local_root=docker_config.local_root, workplace_name=docker_config.workplace_name, downloads_folder=os.path.join(docker_config.local_root, docker_config.workplace_name, "downloads"))
    
    return code_env, web_env, file_env

def create_environment_local(docker_config: DockerConfig):
    """
    1. create the code environment
    2. create the web environment
    3. create the file environment
    """
    code_env = LocalEnv(docker_config)

    web_env = BrowserEnv(browsergym_eval_env = None, local_root=docker_config.local_root, workplace_name=docker_config.workplace_name)
    file_env = RequestsMarkdownBrowser(viewport_size=1024 * 5, local_root=docker_config.local_root, workplace_name=docker_config.workplace_name, downloads_folder=os.path.join(docker_config.local_root, docker_config.workplace_name, "downloads"))
    
    return code_env, web_env, file_env

def update_guidance(context_variables): 
    console = Console()

    # print the logo
    logo_text = Text(MC_LOGO, justify="center")
    console.print(Panel(logo_text, style="bold salmon1", expand=True))
    console.print(version_table)
    console.print(Panel(NOTES,title="Important Notes", expand=True))

@cli.command(name='main')  # 修改这里，使用连字符
@click.option('--container_name', default='auto_agent', help='the function to get the agent')
@click.option('--port', default=12347, help='the port to run the container')
@click.option('--test_pull_name', default='autoagent_mirror', help='the name of the test pull')
@click.option('--git_clone', default=True, help='whether to clone a mirror of the repository')
@click.option('--local_env', default=False, help='whether to use local environment')
def main(container_name: str, port: int, test_pull_name: str, git_clone: bool, local_env: bool):
    """
    Run deep research with a given model, container name, port
    """ 
    model = COMPLETION_MODEL
    print('\033[s\033[?25l', end='')  # Save cursor position and hide cursor
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True  # 这会让进度条完成后消失
    ) as progress:
        task = progress.add_task("[cyan]Initializing...", total=None)
        
        progress.update(task, description="[cyan]Initializing config...[/cyan]\n")
        docker_config = get_config(container_name, port, test_pull_name, git_clone)
        
        progress.update(task, description="[cyan]Setting up logger...[/cyan]\n")
        log_path = osp.join("casestudy_results", 'logs', f'agent_{container_name}_{model}.log')
        LoggerManager.set_logger(MetaChainLogger(log_path = None))
        
        progress.update(task, description="[cyan]Creating environment...[/cyan]\n")
        if local_env:
            code_env, web_env, file_env = create_environment_local(docker_config)
        else:
            code_env, web_env, file_env = create_environment(docker_config)
        
        progress.update(task, description="[cyan]Setting up autoagent...[/cyan]\n")
    
    clear_screen()

    context_variables = {"working_dir": docker_config.workplace_name, "code_env": code_env, "web_env": web_env, "file_env": file_env}

    # select the mode
    while True:
        update_guidance(context_variables)
        mode = single_select_menu(['user mode', 'agent editor', 'workflow editor', 'exit'], "Please select the mode:")
        match mode:
            case 'user mode':
                clear_screen()
                user_mode(model, context_variables, False)
            case 'agent editor':
                clear_screen()
                meta_agent(model, context_variables, False)
            case 'workflow editor':
                clear_screen()
                meta_workflow(model, context_variables, False)
            case 'exit':
                console = Console()
                logo_text = Text(GOODBYE_LOGO, justify="center")
                console.print(Panel(logo_text, style="bold salmon1", expand=True))
                break


def user_mode(model: str, context_variables: dict, debug: bool = True): 
    logger = LoggerManager.get_logger()
    console = Console()
    system_triage_agent = get_system_triage_agent(model)
    assert system_triage_agent.agent_teams != {}, "System Triage Agent must have agent teams"
    messages = []
    agent = system_triage_agent
    agents = {system_triage_agent.name.replace(' ', '_'): system_triage_agent}
    for agent_name in system_triage_agent.agent_teams.keys():
        agents[agent_name.replace(' ', '_')] = system_triage_agent.agent_teams[agent_name]("placeholder").agent
    agents["Upload_files"] = "select"
    style = Style.from_dict({
        'bottom-toolbar': 'bg:#333333 #ffffff',
    })

    # 创建会话
    session = PromptSession(
        completer=UserCompleter(agents.keys()),
        complete_while_typing=True,
        style=style
    )
    client = MetaChain(log_path=logger)
    upload_infos = []
    while True: 
        # query = ask_text("Tell me what you want to do:")
        query = session.prompt(
            'Tell me what you want to do (type "exit" to quit): ',
            bottom_toolbar=HTML('<b>Prompt:</b> Enter <b>@</b> to mention Agents')
        )
        if query.strip().lower() == 'exit':
            # logger.info('User mode completed. See you next time! :waving_hand:', color='green', title='EXIT')
            
            logo_text = "User mode completed. See you next time! :waving_hand:"
            console.print(Panel(logo_text, style="bold salmon1", expand=True))
            break
        words = query.split()
        console.print(f"[bold green]Your request: {query}[/bold green]", end=" ")
        for word in words:
            if word.startswith('@') and word[1:] in agents.keys():
                # print(f"[bold magenta]{word}[bold magenta]", end=' ') 
                agent = agents[word.replace('@', '')]
            else:
                # print(word, end=' ')
                pass
        print()
        
        if hasattr(agent, "name"): 
            agent_name = agent.name
            console.print(f"[bold green][bold magenta]@{agent_name}[/bold magenta] will help you, be patient...[/bold green]")
            if len(upload_infos) > 0:
                query = "{}\n\nUser uploaded files:\n{}".format(query, "\n".join(upload_infos))
            messages.append({"role": "user", "content": query})
            response = client.run(agent, messages, context_variables, debug=debug)
            messages.extend(response.messages)
            model_answer_raw = response.messages[-1]['content']

            # attempt to parse model_answer
            if model_answer_raw.startswith('Case resolved'):
                model_answer = re.findall(r'<solution>(.*?)</solution>', model_answer_raw, re.DOTALL)
                if len(model_answer) == 0:
                    model_answer = model_answer_raw
                else:
                    model_answer = model_answer[0]
            else: 
                model_answer = model_answer_raw
            console.print(f"[bold green][bold magenta]@{agent_name}[/bold magenta] has finished with the response:\n[/bold green] [bold blue]{model_answer}[/bold blue]")
            agent = response.agent
        elif agent == "select": 
            code_env: DockerEnv = context_variables["code_env"]
            local_workplace = code_env.local_workplace
            docker_workplace = code_env.docker_workplace
            files_dir = os.path.join(local_workplace, "files")
            docker_files_dir = os.path.join(docker_workplace, "files")
            os.makedirs(files_dir, exist_ok=True)
            upload_infos.extend(select_and_copy_files(files_dir, console, docker_files_dir))
            agent = agents["System_Triage_Agent"]
        else: 
            console.print(f"[bold red]Unknown agent: {agent}[/bold red]")

@cli.command(name='deep-research')  # 修改这里，使用连字符
@click.option('--container_name', default='deepresearch', help='the function to get the agent')
@click.option('--port', default=12346, help='the port to run the container')
@click.option('--local_env', default=False, help='whether to use local environment')
def deep_research(container_name: str, port: int, local_env: bool):
    """
    Run deep research with a given model, container name, port
    """ 
    model = COMPLETION_MODEL
    print('\033[s\033[?25l', end='')  # Save cursor position and hide cursor
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True  # 这会让进度条完成后消失
    ) as progress:
        task = progress.add_task("[cyan]Initializing...", total=None)
        
        progress.update(task, description="[cyan]Initializing config...[/cyan]\n")
        docker_config = get_config(container_name, port)
        
        progress.update(task, description="[cyan]Setting up logger...[/cyan]\n")
        log_path = osp.join("casestudy_results", 'logs', f'agent_{container_name}_{model}.log')
        LoggerManager.set_logger(MetaChainLogger(log_path = None))
        
        progress.update(task, description="[cyan]Creating environment...[/cyan]\n")
        if local_env:
            code_env, web_env, file_env = create_environment_local(docker_config)
        else:
            code_env, web_env, file_env = create_environment(docker_config)
        
        progress.update(task, description="[cyan]Setting up autoagent...[/cyan]\n")
    
    clear_screen()

    context_variables = {"working_dir": docker_config.workplace_name, "code_env": code_env, "web_env": web_env, "file_env": file_env}

    update_guidance(context_variables)

    logger = LoggerManager.get_logger()
    console = Console()
    system_triage_agent = get_system_triage_agent(model)
    assert system_triage_agent.agent_teams != {}, "System Triage Agent must have agent teams"
    messages = []
    agent = system_triage_agent
    agents = {system_triage_agent.name.replace(' ', '_'): system_triage_agent}
    for agent_name in system_triage_agent.agent_teams.keys():
        agents[agent_name.replace(' ', '_')] = system_triage_agent.agent_teams[agent_name]("placeholder").agent
    agents["Upload_files"] = "select"
    style = Style.from_dict({
        'bottom-toolbar': 'bg:#333333 #ffffff',
    })

    # 创建会话
    session = PromptSession(
        completer=UserCompleter(agents.keys()),
        complete_while_typing=True,
        style=style
    )
    client = MetaChain(log_path=logger)
    while True: 
        # query = ask_text("Tell me what you want to do:")
        query = session.prompt(
            'Tell me what you want to do (type "exit" to quit): ',
            bottom_toolbar=HTML('<b>Prompt:</b> Enter <b>@</b> to mention Agents')
        )
        if query.strip().lower() == 'exit':
            # logger.info('User mode completed.  See you next time! :waving_hand:', color='green', title='EXIT')
            
            logo_text = "See you next time! :waving_hand:"
            console.print(Panel(logo_text, style="bold salmon1", expand=True))
            break
        words = query.split()
        console.print(f"[bold green]Your request: {query}[/bold green]", end=" ")
        for word in words:
            if word.startswith('@') and word[1:] in agents.keys():
                # print(f"[bold magenta]{word}[bold magenta]", end=' ') 
                agent = agents[word.replace('@', '')]
            else:
                # print(word, end=' ')
                pass
        print()
        
        if hasattr(agent, "name"): 
            agent_name = agent.name
            console.print(f"[bold green][bold magenta]@{agent_name}[/bold magenta] will help you, be patient...[/bold green]")
            messages.append({"role": "user", "content": query})
            response = client.run(agent, messages, context_variables, debug=False)
            messages.extend(response.messages)
            model_answer_raw = response.messages[-1]['content']

            # attempt to parse model_answer
            if model_answer_raw.startswith('Case resolved'):
                model_answer = re.findall(r'<solution>(.*?)</solution>', model_answer_raw, re.DOTALL)
                if len(model_answer) == 0:
                    model_answer = model_answer_raw
                else:
                    model_answer = model_answer[0]
            else: 
                model_answer = model_answer_raw
            console.print(f"[bold green][bold magenta]@{agent_name}[/bold magenta] has finished with the response:\n[/bold green] [bold blue]{model_answer}[/bold blue]")
            agent = response.agent
        elif agent == "select": 
            code_env: DockerEnv = context_variables["code_env"]
            local_workplace = code_env.local_workplace
            files_dir = os.path.join(local_workplace, "files")
            os.makedirs(files_dir, exist_ok=True)
            select_and_copy_files(files_dir, console)
        else: 
            console.print(f"[bold red]Unknown agent: {agent}[/bold red]")
    