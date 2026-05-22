<a name="readme-top"></a>

<div align="center">
  <img src="./assets/AutoAgent_logo.svg" alt="Logo" width="200">
  <h1 align="center">AutoAgent: Fully-Automated & Zero-Code</br> LLM Agent Framework </h1>
</div>




<div align="center">
  <a href="https://autoagent-ai.github.io"><img src="https://img.shields.io/badge/Project-Page-blue?style=for-the-badge&color=FFE165&logo=homepage&logoColor=white" alt="Credits"></a>
  <a href="https://join.slack.com/t/metachain-workspace/shared_invite/zt-2zibtmutw-v7xOJObBf9jE2w3x7nctFQ"><img src="https://img.shields.io/badge/Slack-Join%20Us-red?logo=slack&logoColor=white&style=for-the-badge" alt="Join our Slack community"></a>
  <a href="https://discord.gg/jQJdXyDB"><img src="https://img.shields.io/badge/Discord-Join%20Us-purple?logo=discord&logoColor=white&style=for-the-badge" alt="Join our Discord community"></a>
  <!-- <a href="https://github.com/HKUDS/AutoAgent/blob/main/assets/autoagent-wechat.jpg"><img src="https://img.shields.io/badge/Wechat-Join%20Us-green?logo=wechat&logoColor=white&style=for-the-badge" alt="Join our Wechat community"></a> -->
  <a href="./Communication.md"><img src="https://img.shields.io/badge/💬Feishu-Group-07c160?style=for-the-badge&logoColor=white&labelColor=1a1a2e"></a>
  <a href="./Communication.md"><img src="https://img.shields.io/badge/WeChat-Group-07c160?style=for-the-badge&logo=wechat&logoColor=white&labelColor=1a1a2e"></a>
  
  <br/>
  <a href="https://autoagent-ai.github.io/docs"><img src="https://img.shields.io/badge/Documentation-000?logo=googledocs&logoColor=FFE165&style=for-the-badge" alt="Check out the documentation"></a>
  <a href="https://arxiv.org/abs/2502.05957"><img src="https://img.shields.io/badge/Paper%20on%20Arxiv-000?logoColor=FFE165&logo=arxiv&style=for-the-badge" alt="Paper"></a>
  <a href="https://gaia-benchmark-leaderboard.hf.space/"><img src="https://img.shields.io/badge/GAIA%20Benchmark-000?logoColor=FFE165&logo=huggingface&style=for-the-badge" alt="Evaluation Benchmark Score"></a>
  <hr>
</div>

<div align="center">
<a href="https://trendshift.io/repositories/13954" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13954" alt="HKUDS%2FAutoAgent | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

Welcome to AutoAgent! AutoAgent is a **Fully-Automated** and highly **Self-Developing** framework that enables users to create and deploy LLM agents through **Natural Language Alone**. 

## ✨Key Features of AutoAgent

* 💬 **Natural Language-Driven Agent Building** 
</br>Automatically constructs and orchestrates collaborative agent systems purely through natural dialogue, eliminating the need for manual coding or technical configuration.

* 🚀 **Zero-Code Framework**
</br>Democratizes AI development by allowing anyone, regardless of coding experience, to create and customize their own agents, tools, and workflows using natural language alone.

* ⚡ **Self-Managing Workflow Generation**
</br>Dynamically creates, optimizes and adapts agent workflows based on high-level task descriptions, even when users cannot fully specify implementation details.

* 🔧 **Intelligent Resource Orchestration**
</br>Enables controlled code generation for creating tools, agents, and workflows through iterative self-improvement, supporting both single agent creation and multi-agent workflow generation.

* 🎯 **Self-Play Agent Customization** 
</br>Enables controlled code generation for creating tools, agents, and workflows through iterative self-improvement, supporting both single agent creation and multi-agent workflow generation.

🚀 Unlock the Future of LLM Agents. Try 🔥AutoAgent🔥 Now!

<div align="center">
  <!-- <img src="./assets/AutoAgentnew-intro.pdf" alt="Logo" width="100%"> -->
  <figure>
    <img src="./assets/autoagent-intro.svg" alt="Logo" style="max-width: 100%; height: auto;">
    <figcaption><em>Quick Overview of AutoAgent.</em></figcaption>
  </figure>
</div>



## 🔥 News

<div class="scrollable">
    <ul>
      <li><strong>[2025, Feb 17]</strong>: &nbsp;🎉🎉We've updated and released AutoAgent v0.2.0 (formerly known as MetaChain). Detailed changes include: 1) fix the bug of different LLM providers from issues; 2) add automatic installation of AutoAgent in the container environment according to issues; 3) add more easy-to-use commands for the CLI mode. 4) Rename the project to AutoAgent for better understanding.</li>
      <li><strong>[2025, Feb 10]</strong>: &nbsp;🎉🎉We've released <b>MetaChain!</b>, including framework, evaluation codes and CLI mode! Check our <a href="https://arxiv.org/abs/2502.05957">paper</a> for more details.</li>
    </ul>
</div>
<span id='table-of-contents'/>

## 📑 Table of Contents

* <a href='#features'>✨ Features</a>
* <a href='#news'>🔥 News</a>
* <a href='#how-to-use'>🔍 How to Use AutoAgent</a>
  * <a href='#user-mode'>1. `user mode` (Deep Research Agents)</a>
  * <a href='#agent-editor'>2. `agent editor` (Agent Creation without Workflow)</a>
  * <a href='#workflow-editor'>3. `workflow editor` (Agent Creation with Workflow)</a>
* <a href='#quick-start'>⚡ Quick Start</a>
  * <a href='#installation'>Installation</a>
  * <a href='#api-keys-setup'>API Keys Setup</a>
  * <a href='#start-with-cli-mode'>Start with CLI Mode</a>
* <a href='#todo'>☑️ Todo List</a>
* <a href='#reproduce'>🔬 How To Reproduce the Results in the Paper</a>
* <a href='#documentation'>📖 Documentation</a>
* <a href='#community'>🤝 Join the Community</a>
* <a href='#acknowledgements'>🙏 Acknowledgements</a>
* <a href='#cite'>🌟 Cite</a>

<span id='how-to-use'/>

## 🔍 How to Use AutoAgent

<span id='user-mode'/>

### 1. `user mode` (Deep Research Agents)

AutoAgent features a ready-to-use multi-agent system accessible through user mode on the start page. This system serves as a comprehensive AI research assistant designed for information retrieval, complex analytical tasks, and comprehensive report generation.

- 🚀 **High Performance**: Matches Deep Research using Claude 3.5 rather than OpenAI's o3 model.
- 🔄 **Model Flexibility**: Compatible with any LLM (including Deepseek-R1, Grok, Gemini, etc.)
- 💰 **Cost-Effective**: Open-source alternative to Deep Research's $200/month subscription
- 🎯 **User-Friendly**: Easy-to-deploy CLI interface for seamless interaction
- 📁 **File Support**: Handles file uploads for enhanced data interaction

<div align="center">
  <video width="80%" controls>
    <source src="./assets/video_v1_compressed.mp4" type="video/mp4">
  </video>
  <p><em>🎥 Deep Research (aka User Mode)</em></p>
</div>



<span id='agent-editor'/>

### 2. `agent editor` (Agent Creation without Workflow)

The most distinctive feature of AutoAgent is its natural language customization capability. Unlike other agent frameworks, AutoAgent allows you to create tools, agents, and workflows using natural language alone. Simply choose `agent editor` or `workflow editor` mode to start your journey of building agents through conversations.

You can use `agent editor` as shown in the following figure.

<table>
<tr align="center">
    <td width="33%">
        <img src="./assets/agent_editor/1-requirement.png" alt="requirement" width="100%"/>
        <br>
        <em>Input what kind of agent you want to create.</em>
    </td>
    <td width="33%">
        <img src="./assets/agent_editor/2-profiling.png" alt="profiling" width="100%"/>
        <br>
        <em>Automated agent profiling.</em>
    </td>
    <td width="33%">
        <img src="./assets/agent_editor/3-profiles.png" alt="profiles" width="100%"/>
        <br>
        <em>Output the agent profiles.</em>
    </td>
</tr>
</table>
<table>
<tr align="center">
    <td width="33%">
        <img src="./assets/agent_editor/4-tools.png" alt="tools" width="100%"/>
        <br>
        <em>Create the desired tools.</em>
    </td>
    <td width="33%">
        <img src="./assets/agent_editor/5-task.png" alt="task" width="100%"/>
        <br>
        <em>Input what do you want to complete with the agent. (Optional)</em>
    </td>
    <td width="33%">
        <img src="./assets/agent_editor/6-output-next.png" alt="output" width="100%"/>
        <br>
        <em>Create the desired agent(s) and go to the next step.</em>
    </td>
</tr>
</table>

<span id='workflow-editor'/>

### 3. `workflow editor` (Agent Creation with Workflow)

You can also create the agent workflows using natural language description with the `workflow editor` mode, as shown in the following figure. (Tips: this mode does not support tool creation temporarily.)

<table>
<tr align="center">
    <td width="33%">
        <img src="./assets/workflow_editor/1-requirement.png" alt="requirement" width="100%"/>
        <br>
        <em>Input what kind of workflow you want to create.</em>
    </td>
    <td width="33%">
        <img src="./assets/workflow_editor/2-profiling.png" alt="profiling" width="100%"/>
        <br>
        <em>Automated workflow profiling.</em>
    </td>
    <td width="33%">
        <img src="./assets/workflow_editor/3-profiles.png" alt="profiles" width="100%"/>
        <br>
        <em>Output the workflow profiles.</em>
    </td>
</tr>
</table>
<table>
<tr align="center">
    <td width="33%">
        <img src="./assets/workflow_editor/4-task.png" alt="task" width="66%"/>
        <br>
        <em>Input what do you want to complete with the workflow. (Optional)</em>
    </td>
    <td width="33%">
        <img src="./assets/workflow_editor/5-output-next.png" alt="output" width="66%"/>
        <br>
        <em>Create the desired workflow(s) and go to the next step.</em>
    </td>
</tr>
</table>

<span id='quick-start'/>

## ⚡ Quick Start

<span id='installation'/>

### Installation

#### AutoAgent Installation

```bash
git clone https://github.com/HKUDS/AutoAgent.git
cd AutoAgent
pip install -e .
```

#### Docker Installation

We use Docker to containerize the agent-interactive environment. So please install [Docker](https://www.docker.com/) first. You don't need to manually pull the pre-built image, because we have let Auto-Deep-Research **automatically pull the pre-built image based on your architecture of your machine**.

<span id='api-keys-setup'/>

### API Keys Setup

Create an environment variable file, just like `.env.template`, and set the API keys for the LLMs you want to use. Not every LLM API Key is required, use what you need.

```bash
# Required Github Tokens of your own
GITHUB_AI_TOKEN=

# Optional API Keys
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
HUGGINGFACE_API_KEY=
GROQ_API_KEY=
XAI_API_KEY=
```

<span id='start-with-cli-mode'/>

### Start with CLI Mode

> [🚨 **News**: ] We have updated a more easy-to-use command to start the CLI mode and fix the bug of different LLM providers from issues. You can follow the following steps to start the CLI mode with different LLM providers with much less configuration.

#### Command Options:

You can run `auto main` to start full part of AutoAgent, including `user mode`, `agent editor` and `workflow editor`. Btw, you can also run `auto deep-research` to start more lightweight `user mode`, just like the [Auto-Deep-Research](https://github.com/HKUDS/Auto-Deep-Research) project. Some configuration of this command is shown below. 

- `--container_name`: Name of the Docker container (default: 'deepresearch')
- `--port`: Port for the container (default: 12346)
- `COMPLETION_MODEL`: Specify the LLM model to use, you should follow the name of [Litellm](https://github.com/BerriAI/litellm) to set the model name. (Default: `claude-3-5-sonnet-20241022`)
- `DEBUG`: Enable debug mode for detailed logs (default: False)
- `API_BASE_URL`: The base URL for the LLM provider (default: None)
- `FN_CALL`: Enable function calling (default: None). Most of time, you could ignore this option because we have already set the default value based on the model name.
- `git_clone`: Clone the AutoAgent repository to the local environment (only support with the `auto main` command, default: True)
- `test_pull_name`: The name of the test pull. (only support with the `auto main` command, default: 'autoagent_mirror')

#### More details about `git_clone` and `test_pull_name`] 

In the `agent editor` and `workflow editor` mode, we should clone a mirror of the AutoAgent repository to the local agent-interactive environment and let our **AutoAgent** automatically update the AutoAgent itself, such as creating new tools, agents and workflows. So if you want to use the `agent editor` and `workflow editor` mode, you should set the `git_clone` to True and set the `test_pull_name` to 'autoagent_mirror' or other branches.

#### `auto main` with different LLM Providers

Then I will show you how to use the full part of AutoAgent with the `auto main` command and different LLM providers. If you want to use the `auto deep-research` command, you can refer to the [Auto-Deep-Research](https://github.com/HKUDS/Auto-Deep-Research) project for more details.

##### Anthropic

* set the `ANTHROPIC_API_KEY` in the `.env` file.

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
auto main # default model is claude-3-5-sonnet-20241022
```

##### OpenAI

* set the `OPENAI_API_KEY` in the `.env` file.

```bash
OPENAI_API_KEY=your_openai_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=gpt-4o auto main
```

##### Mistral

* set the `MISTRAL_API_KEY` in the `.env` file.

```bash
MISTRAL_API_KEY=your_mistral_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=mistral/mistral-large-2407 auto main
```

##### Gemini - Google AI Studio

* set the `GEMINI_API_KEY` in the `.env` file.

```bash
GEMINI_API_KEY=your_gemini_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=gemini/gemini-2.0-flash auto main
```

##### Huggingface

* set the `HUGGINGFACE_API_KEY` in the `.env` file.

```bash
HUGGINGFACE_API_KEY=your_huggingface_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=huggingface/meta-llama/Llama-3.3-70B-Instruct auto main
```

##### Groq

* set the `GROQ_API_KEY` in the `.env` file.

```bash
GROQ_API_KEY=your_groq_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=groq/deepseek-r1-distill-llama-70b auto main
```

##### OpenAI-Compatible Endpoints (e.g., Grok)

* set the `OPENAI_API_KEY` in the `.env` file.

```bash
OPENAI_API_KEY=your_api_key_for_openai_compatible_endpoints
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=openai/grok-2-latest API_BASE_URL=https://api.x.ai/v1 auto main
```

##### OpenRouter (e.g., DeepSeek-R1)

We recommend using OpenRouter as LLM provider of DeepSeek-R1 temporarily. Because official API of DeepSeek-R1 can not be used efficiently.

* set the `OPENROUTER_API_KEY` in the `.env` file.

```bash
OPENROUTER_API_KEY=your_openrouter_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=openrouter/deepseek/deepseek-r1 auto main
```

##### DeepSeek

* set the `DEEPSEEK_API_KEY` in the `.env` file.

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
COMPLETION_MODEL=deepseek/deepseek-chat auto main
```

##### MiniMax

* set the `MINIMAX_API_KEY` in the `.env` file. MiniMax exposes an OpenAI-compatible endpoint, so we route requests through the `openai/` provider in LiteLLM.

```bash
MINIMAX_API_KEY=your_minimax_api_key
```

* run the following command to start Auto-Deep-Research.

```bash
OPENAI_API_KEY=$MINIMAX_API_KEY COMPLETION_MODEL=openai/MiniMax-M2.7 API_BASE_URL=https://api.minimax.io/v1 auto main
```

> Available models: `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`. Use `https://api.minimaxi.com/v1` as `API_BASE_URL` for the Mainland China region.


After the CLI mode is started, you can see the start page of AutoAgent: 

<div align="center">
  <!-- <img src="./assets/AutoAgentnew-intro.pdf" alt="Logo" width="100%"> -->
  <figure>
    <img src="./assets/cover.png" alt="Logo" style="max-width: 100%; height: auto;">
    <figcaption><em>Start Page of AutoAgent.</em></figcaption>
  </figure>
</div>

### Tips

#### Import browser cookies to browser environment

You can import the browser cookies to the browser environment to let the agent better access some specific websites. For more details, please refer to the [cookies](./AutoAgent/environment/cookie_json/README.md) folder.

#### Add your own API keys for third-party Tool Platforms

If you want to create tools from the third-party tool platforms, such as RapidAPI, you should subscribe tools from the platform and add your own API keys by running [process_tool_docs.py](./process_tool_docs.py). 

```bash
python process_tool_docs.py
```

More features coming soon! 🚀 **Web GUI interface** under development.



<span id='todo'/>

## ☑️ Todo List

AutoAgent is continuously evolving! Here's what's coming:

- 📊 **More Benchmarks**: Expanding evaluations to **SWE-bench**, **WebArena**, and more
- 🖥️ **GUI Agent**: Supporting *Computer-Use* agents with GUI interaction
- 🔧 **Tool Platforms**: Integration with more platforms like **Composio**
- 🏗️ **Code Sandboxes**: Supporting additional environments like **E2B**
- 🎨 **Web Interface**: Developing comprehensive GUI for better user experience

Have ideas or suggestions? Feel free to open an issue! Stay tuned for more exciting updates! 🚀

<span id='reproduce'/>

## 🔬 How To Reproduce the Results in the Paper

### GAIA Benchmark
For the GAIA benchmark, you can run the following command to run the inference.

```bash
cd path/to/AutoAgent && sh evaluation/gaia/scripts/run_infer.sh
```

For the evaluation, you can run the following command.

```bash
cd path/to/AutoAgent && python evaluation/gaia/get_score.py
```

### Agentic-RAG

For the Agentic-RAG task, you can run the following command to run the inference.

Step1. Turn to [this page](https://huggingface.co/datasets/yixuantt/MultiHopRAG) and download it. Save them to your datapath.

Step2. Run the following command to run the inference.

```bash
cd path/to/AutoAgent && sh evaluation/multihoprag/scripts/run_rag.sh
```

Step3. The result will be saved in the `evaluation/multihoprag/result.json`.

<span id='documentation'/>

## 📖 Documentation

A more detailed documentation is coming soon 🚀, and we will update in the [Documentation](https://AutoAgent-ai.github.io/docs) page.

<span id='community'/>

## 🤝 Join the Community

We want to build a community for AutoAgent, and we welcome everyone to join us. You can join our community by:

- [Join our Slack workspace](https://join.slack.com/t/AutoAgent-workspace/shared_invite/zt-2zibtmutw-v7xOJObBf9jE2w3x7nctFQ) - Here we talk about research, architecture, and future development.
- [Join our Discord server](https://discord.gg/z68KRvwB) - This is a community-run server for general discussion, questions, and feedback. 
- [Read or post Github Issues](https://github.com/HKUDS/AutoAgent/issues) - Check out the issues we're working on, or add your own ideas.

<span id='acknowledgements'/>



## Misc

<div align="center">

[![Stargazers repo roster for @HKUDS/AutoAgent](https://reporoster.com/stars/HKUDS/AutoAgent)](https://github.com/HKUDS/AutoAgent/stargazers)

[![Forkers repo roster for @HKUDS/AutoAgent](https://reporoster.com/forks/HKUDS/AutoAgent)](https://github.com/HKUDS/AutoAgent/network/members)

[![Star History Chart](https://api.star-history.com/svg?repos=HKUDS/AutoAgent&type=Date)](https://star-history.com/#HKUDS/AutoAgent&Date)

</div>

## 🙏 Acknowledgements

Rome wasn't built in a day. AutoAgent stands on the shoulders of giants, and we are deeply grateful for the outstanding work that came before us. Our framework architecture draws inspiration from [OpenAI Swarm](https://github.com/openai/swarm), while our user mode's three-agent design benefits from [Magentic-one](https://github.com/microsoft/autogen/tree/main/python/packages/autogen-magentic-one)'s insights. We've also learned from [OpenHands](https://github.com/All-Hands-AI/OpenHands) for documentation structure and many other excellent projects for agent-environment interaction design, among others. We express our sincere gratitude and respect to all these pioneering works that have been instrumental in shaping AutoAgent.


<span id='cite'/>

## 🌟 Cite

```tex
@misc{AutoAgent,
      title={{AutoAgent: A Fully-Automated and Zero-Code Framework for LLM Agents}},
      author={Jiabin Tang, Tianyu Fan, Chao Huang},
      year={2025},
      eprint={202502.05957},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2502.05957},
}
```





