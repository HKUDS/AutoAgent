import requests
import json
from typing import Dict, List, Optional, Union, Any
import os
from constant import OLLAMA_BASE_URL

class OllamaClient:
    """Client for interacting with local Ollama API"""

    def __init__(self, base_url: str = OLLAMA_BASE_URL):
        """
        Initialize the Ollama client

        Args:
            base_url: Base URL for Ollama API, defaults to OLLAMA_BASE_URL constant
        """
        self.base_url = base_url
        self.session = requests.Session()

    def list_models(self) -> Dict:
        """
        List available models in Ollama

        Returns:
            Dict: Response containing available models
        """
        try:
            response = self.session.get(f'{self.base_url}/api/tags')
            response.raise_for_status()
            return {'status': 0, 'models': response.json()['models']}
        except Exception as e:
            return {'status': -1, 'message': f'Failed to list models: {str(e)}'}

    def generate(self, model: str, prompt: str,
                 system: Optional[str] = None,
                 temperature: float = 0.7,
                 stream: bool = False) -> Dict:
        """
        Generate a response using the specified model

        Args:
            model: Name of the Ollama model to use
            prompt: The user prompt
            system: Optional system prompt
            temperature: Sampling temperature (0-1)
            stream: Whether to stream the response

        Returns:
            Dict: The generation result
        """
        url = f'{self.base_url}/api/generate'
        data = {
            'model': model,
            'prompt': prompt,
            'temperature': temperature,
            'stream': stream
        }

        if system:
            data['system'] = system

        try:
            response = self.session.post(url, json=data)
            response.raise_for_status()

            if stream:
                return self._handle_stream(response)
            else:
                return {'status': 0, 'response': response.json()['response']}
        except Exception as e:
            return {'status': -1, 'message': f'Generation failed: {str(e)}'}

    def _handle_stream(self, response) -> Dict:
        """
        Handle streaming response from Ollama

        Args:
            response: The streaming response object

        Returns:
            Dict: The combined streamed response
        """
        full_response = ""
        try:
            for line in response.iter_lines():
                if line:
                    chunk = json.loads(line)
                    if 'response' in chunk:
                        full_response += chunk['response']
            return {'status': 0, 'response': full_response}
        except Exception as e:
            return {'status': -1, 'message': f'Streaming failed: {str(e)}'}

    def chat(self, model: str, messages: List[Dict],
             temperature: float = 0.7,
             stream: bool = False) -> Dict:
        """
        Chat completion using the specified model

        Args:
            model: Name of the Ollama model to use
            messages: List of message objects with role and content
            temperature: Sampling temperature (0-1)
            stream: Whether to stream the response

        Returns:
            Dict: The chat completion result
        """
        url = f'{self.base_url}/api/chat'
        data = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'stream': stream
        }

        try:
            response = self.session.post(url, json=data)
            response.raise_for_status()

            if stream:
                return self._handle_chat_stream(response)
            else:
                result = response.json()
                return {'status': 0, 'message': result['message']}
        except Exception as e:
            return {'status': -1, 'message': f'Chat failed: {str(e)}'}

    def _handle_chat_stream(self, response) -> Dict:
        """
        Handle streaming chat response from Ollama

        Args:
            response: The streaming response object

        Returns:
            Dict: The combined streamed response
        """
        full_response = {'content': ''}
        try:
            for line in response.iter_lines():
                if line:
                    chunk = json.loads(line)
                    if 'message' in chunk and 'content' in chunk['message']:
                        full_response['content'] += chunk['message']['content']
            return {'status': 0, 'message': full_response}
        except Exception as e:
            return {'status': -1, 'message': f'Chat streaming failed: {str(e)}'}
