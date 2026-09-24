from autoagent.registry import register_tool
from browsergym.core.action.highlevel import HighLevelActionSet
from typing import Literal
from autoagent.environment import DockerEnv, DockerConfig, BrowserEnv, VIEWPORT
from browsergym.utils.obs import flatten_axtree_to_str
from dataclasses import dataclass, field
from typing import Dict
from urllib.parse import quote_plus
from autoagent.types import Result
from functools import partial, update_wrapper
from inspect import signature
import tiktoken
from datetime import datetime
from autoagent.util import function_to_json
from autoagent.tools.md_obs import flatten_md_axtree_to_str
from autoagent.tools.parallel_search import ParallelSearchMCP, dispatch_search
# def with_env(env: BrowserEnv):
#     """将env注入到工具函数中的装饰器"""
#     def decorator(func):
#         # 创建新函数，固定env参数
#         new_func = partial(func, env=env)
#         # 保留原始函数的docstring和signature
#         update_wrapper(new_func, func)
#         # 修改signature，移除env参数
#         new_func.__signature__ = signature(func).replace(
#             parameters=[p for p in signature(func).parameters.values() if p.name != 'env']
#         )
#         return new_func
#     return decorator
def with_env(env: BrowserEnv):
    """将env注入到工具函数中的装饰器"""
    def decorator(func):
        def wrapped(*args, **kwargs):
            return func(env=env, *args, **kwargs)
        
        # 保留原始函数的所有属性
        update_wrapper(wrapped, func)
        # 修改signature，移除env参数
        wrapped.__signature__ = signature(func).replace(
            parameters=[p for p in signature(func).parameters.values() if p.name != 'env']
        )
        return wrapped
    return decorator

def with_two_envs(env: BrowserEnv, code_env: DockerEnv):
    """将env注入到工具函数中的装饰器"""
    def decorator(func):
        def wrapped(*args, **kwargs):
            return func(env=env, code_env=code_env, *args, **kwargs)
        
        # 保留原始函数的所有属性
        update_wrapper(wrapped, func)
        # 修改signature，移除env参数
        wrapped.__signature__ = signature(func).replace(
            parameters=[p for p in signature(func).parameters.values() if p.name not in ['env', 'code_env']]
        )
        return wrapped
    return decorator
@dataclass
class WebObservation:
    content: str  # text content of the page
    url: str # URL of the page
    screenshot: str  # base64-encoded screenshot, png
    open_pages_urls: list[str] # list of open pages
    active_page_index: int  # index of the active page
    dom_object: dict  # DOM object
    axtree_object: dict  # accessibility tree object
    extra_element_properties: dict
    focused_element_bid: str  # focused element bid
    last_browser_action: str  # last browser env action performed
    last_browser_action_error: str # last browser env action error
    error: bool  # error flag

def to_web_obs(obs) -> WebObservation:
    obs_dict = dict(
        content=obs['text_content'],  # text content of the page
        url=obs.get('url', ''),  # URL of the page
        # screenshot=obs.get('screenshot', None),  # base64-encoded screenshot, png
        screenshot=None,  # base64-encoded screenshot, png
        open_pages_urls=obs.get('open_pages_urls', []),  # list of open pages
        active_page_index=obs.get(
            'active_page_index', -1
        ),  # index of the active page
        dom_object=obs.get('dom_object', {}),  # DOM object
        axtree_object=obs.get('axtree_object', {}),  # accessibility tree object
        extra_element_properties=obs.get('extra_element_properties', {}),
        focused_element_bid=obs.get(
            'focused_element_bid', None
        ),  # focused element bid
        last_browser_action=obs.get(
            'last_action', ''
        ),  # last browser env action performed
        last_browser_action_error=obs.get('last_action_error', ''),
        error=True if obs.get('last_action_error', '') else False,  # error flag
    )
    return WebObservation(**obs_dict)
def wrap_return_value(web_obs: WebObservation, action_description: str = ""):
    error_prefix = ""
    if web_obs.error:
        error_prefix = get_error_prefix(web_obs.last_browser_action, web_obs.last_browser_action_error)
    cur_url = web_obs.url
    try:
        cur_axtree_txt = flatten_axtree_to_str(
            web_obs.axtree_object,
            extra_properties=web_obs.extra_element_properties,
            with_clickable=True,
            filter_visible_only=True,
        )
    except Exception as e:
        cur_axtree_txt = f'Error encountered when browsing.\nError when trying to process the accessibility tree:{str(e)}'
    ret_value = f"""\
{error_prefix}
{action_description}

# Current Page URL:
{cur_url}

# Current Accessibility Tree:
{cur_axtree_txt}

Here is an example with chain of thought of a valid action when clicking on a button:
"
In order to accomplish my goal I need to click on the button with bid 12
```click("12")```
"
""".strip()
    return ret_value

def wrap_return_value_markdown(web_obs: WebObservation, action_description: str = ""):
    error_prefix = ""
    if web_obs.error:
        error_prefix = get_error_prefix(web_obs.last_browser_action, web_obs.last_browser_action_error)
    cur_url = web_obs.url
    try:
        cur_axtree_txt = flatten_md_axtree_to_str(
            web_obs.axtree_object,
            extra_properties=web_obs.extra_element_properties,
            with_clickable=True,
            filter_visible_only=True,
        )
    except Exception as e:
        cur_axtree_txt = f'Error encountered when browsing.\nError when trying to process the accessibility tree:{str(e)}'
    ret_value = f"""\
{error_prefix}
{action_description}

# The current page is converted to markdown format:
{cur_axtree_txt}

If the content is too long, you can use `page_down()` and `page_up()` to navigate through the text.
If you have not yet got the answer and want to back to the previous page, please use `history_back()` to navigate back.
""".strip()
    return ret_value
def get_error_prefix(last_browser_action: str, last_browser_action_error: str) -> str:
    return f'IMPORTANT! Last action is incorrect:\n{last_browser_action}\nThink again with the current observation of the page.\nThe error message is:\n{last_browser_action_error}'

# @register_tool("click")
# def click(env: BrowserEnv, bid: str, button: Literal["left", "middle", "right"] = "left", modifiers: list[Literal["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]] = []):
#     """
#     Clicks the mouse on the target with the given element bid.
#     Args:
#         bid: The bid of the element to click.
#         button: The button to click.
#         modifiers: The modifiers to click.
#     """
#     try:
#         # 执行动作
#         # action = action_func(*args, **kwargs)
#         button_str = f''', button="{button}"''' if button else ''
#         modifiers_str = f', modifiers={modifiers}' if modifiers else ''
#         action_str = f"""click('{bid}'{button_str}{modifiers_str})"""
        
#         # 与环境交互
#         obs = env.step(action_str)
#         web_obs = to_web_obs(obs)
        
#     except Exception as e:
#         return f"Error encountered when taking action: {action_str}\nError: {e}"
#     ret_value = wrap_return_value(web_obs)
#     return Result(
#             value=ret_value,
#             image=web_obs.screenshot, 
#         )
@register_tool("click")
def click(context_variables, bid: str, button: Literal["left", "middle", "right"] = "left"):
    """
    Clicks the mouse on the target with the given element bid.
    Args:
        bid: The bid of the element to click.
        button: The button to click.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:
        # 执行动作
        # action = action_func(*args, **kwargs)
        button_str = f''', button="{button}"''' if button else ''
        action_str = f"""_click_id('{bid}'{button_str})"""
        
        # 与环境交互
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
        
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
@register_tool("page_down")
def page_down(context_variables):
    """
    Scrolls the entire browser viewport one page DOWN towards the end.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:    
        action_str = f'scroll(0, {VIEWPORT["height"]-50})'
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    if web_obs.url.startswith("data:text/html;base64,"): 
        ret_value = wrap_return_value_markdown(web_obs)
    else:
        ret_value = wrap_return_value(web_obs)

    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
@register_tool("page_up")
def page_up(context_variables):
    """
    Scrolls the entire browser viewport one page UP towards the beginning.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:    
        action_str = f'scroll(0, -{VIEWPORT["height"]-50})'
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    if web_obs.url.startswith("data:text/html;base64,"): 
        ret_value = wrap_return_value_markdown(web_obs)
    else:
        ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
@register_tool("history_back")
def history_back(context_variables):
    """
    Navigates back one page in the browser's history. This is equivalent to clicking the browser back button.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:
        action_str = 'go_back()'
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
@register_tool("history_forward")
def history_forward(context_variables):
    """
    Navigates forward one page in the browser's history. This is equivalent to clicking the browser forward button.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:
        action_str = 'go_forward()'
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
@register_tool("input_text")
def input_text(context_variables, bid: str, text: str):
    """
    Types the given text value into the specified field.
    Args:
        bid: The bid of the element to type into.
        text: The text to type into the input field.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:
        action_str = f"fill('{bid}', '{text}')"
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )

@register_tool("visit_url")
def visit_url(context_variables, url: str): 
    """
    Navigate directly to a provided URL using the browser's address bar. Prefer this tool over other navigation techniques in cases where the user provides a fully-qualified URL (e.g., choose it over clicking links, or inputing queries into search boxes).
    Args:
        url: The URL to navigate to.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    try:
        if url.startswith(("https://", "http://", "file://", "about:")):
            action_str = f"_visit_page('{url}')"
            obs = env.step(action_str)
            web_obs = to_web_obs(obs)
        elif " " in url:
            query = quote_plus(url)
            action_str = f"_visit_page('https://www.google.com.sg/search?q={query}&hl=en&gl=US')"
            obs = env.step(action_str)
            web_obs = to_web_obs(obs)
        else:
            action_str = f"_visit_page('https://{url}')"
            obs = env.step(action_str)
            web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )

@register_tool("web_search")
def web_search(context_variables, query: str):
    """
    Performs a web search with the selected provider.
    Args:
        query: The query to search for.
    """
    def bing_search(search_query: str):
        env: BrowserEnv = context_variables.get("web_env", None)
        assert env is not None, "web_env is not set"
        try:
            action_str = f"_visit_page('https://www.bing.com/search?q={quote_plus(search_query)}&FORM=QBLH&hl=en')"

            obs = env.step(action_str)
            web_obs = to_web_obs(obs)
        except Exception as error:
            return f"Error encountered when taking action: {action_str}\nError: {error}"
        ret_value = wrap_return_value(web_obs)
        return Result(
            value=ret_value,
            image=web_obs.screenshot,
        )

    def parallel_search(search_query: str):
        try:
            return Result(value=ParallelSearchMCP().search(search_query))
        except Exception as error:
            return f"Error encountered while searching the Parallel MCP endpoint.\nError: {error}"

    return dispatch_search(context_variables, query, bing_search, parallel_search)
@register_tool("sleep")
def sleep(context_variables):
    """
    Wait a short period of time. Call this function if the page has not yet fully loaded, or if it is determined that a small delay would increase the task's chances of success.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"

    try: 
        action_str = f"noop(3000)"
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"
    ret_value = wrap_return_value(web_obs)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )
def truncate_by_tokens(env: DockerEnv, text, max_tokens = 4096, model="gpt-4o-2024-08-06"):
    from autoagent.tools.terminal_tools import create_file, create_directory
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)
    
    if len(tokens) <= max_tokens:
        return text
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    create_directory(f"{env.docker_workplace}/web_page_markdown_output", context_variables={"code_env": env})
    output_path = f"{env.docker_workplace}/web_page_markdown_output/full_output_{timestamp}.md"
    create_msg = create_file(output_path, content = text, context_variables={"code_env": env})
    # 截断tokens并解码回字符串
    truncated_tokens_bos = tokens[:max_tokens//2]
    truncated_tokens_eos = tokens[-(max_tokens - len(truncated_tokens_bos)):]
    if create_msg.startswith("Error"):
        return encoding.decode(truncated_tokens_bos) + "\n...\n" + encoding.decode(truncated_tokens_eos) + "\n\nThe full convert markdown output is too long, so I want to save them into the file: {0}\n\nBut I got an error: {1}".format(output_path, create_msg)
    
    return encoding.decode(truncated_tokens_bos) + "\n...\n" + encoding.decode(truncated_tokens_eos) + "\n\nThe full convert markdown output is too long, so it is saved in the file: {0}\n\nYou may use the `File Surfer Agent` to view the full output.".format(output_path)

@register_tool("get_page_markdown")
def get_page_markdown(context_variables):
    """
    Get the markdown content of the current page. 
    Use this tool if you need to watch the Youtube video, Wikipedia page, or other pages that contain media content. 
    Note that this tool can only be used after you have visited a valid page.
    """
    env: BrowserEnv = context_variables.get("web_env", None)
    assert env is not None, "web_env is not set"
    # code_env: DockerEnv = context_variables.get("code_env", None)
    # assert code_env is not None, "code_env is not set"
    try:
        action_str = "_get_page_markdown()"
        obs = env.step(action_str)
        web_obs = to_web_obs(obs)
        # obs = env.step("go_back()")
    except Exception as e:
        return f"Error encountered when taking action: {action_str}\nError: {e}"

#     ret_value = \
# f"""
# I have converted the current page into clean markdown format:
# {web_obs.content}
# """.strip()
    ret_value = wrap_return_value_markdown(web_obs)
    # ret_value = truncate_by_tokens(code_env, ret_value, max_tokens=10000)
    return Result(
            value=ret_value,
            image=web_obs.screenshot, 
        )

if __name__ == "__main__":
    env = BrowserEnv(browsergym_eval_env = None, local_root="/Users/tangjiabin/Documents/reasoning/autoagent", workplace_name="workplace_gaia_eval")
    # code_env = DockerEnv(DockerConfig(container_name = "gaia_lite_eval", 
    # workplace_name = "workplace_gaia_eval", 
    # communication_port = 12345, 
    # conda_path = "/root/miniconda3"))
    # code_env.init_container()
    # import json
    # web_search_with_env = with_env(env)(web_search)
    # print(json.dumps(function_to_json(web_search_with_env), indent=4))
    # visit_url(env, "https://scholar.google.com.hk/scholar?hl=zh-CN&as_sdt=0%2C5&q=LLMRec&oq=")
    # res = page_down(env)
    # print(res.value)
    # res = visit_url(env, 'https://arxiv.org/pdf/2310.13023')
    # print(res.value)


    context_variables = {"web_env": env}
    res = visit_url(context_variables, 'https://www.youtube.com/watch?v=pPStdjuYzSI')
    # res = visit_url(env, 'https://www.reddit.com/r/ChatGPT/comments/1h5ey4m/chatgpt_helped_me_not_blow_up_on_my_boss/')
    print("******visit_url", res.value)  

    res = get_page_markdown(context_variables)
    print("******get_page_markdown", res.value)
    # res = page_down(context_variables)
    # print("******page_down", res.value)
    # res = history_back(context_variables)
    # print("******history_back", res.value)
    
    # print(function_to_json(page_down))