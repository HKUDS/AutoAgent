import os
from typing import List, Dict
from autoagent.memory.rag_memory import Memory, Reranker
import openai
import re
from autoagent.memory.code_tree.code_parser import CodeParser, to_dataframe_row
from tree_sitter import Language
from loguru import logger
from openai import OpenAI
import pandas as pd
class CodeTreeMemory(Memory):
    def __init__(self, project_path: str, db_name: str = '.code_tree', platform: str = 'OpenAI', api_key: str = None, embedding_model: str = "text-embedding-ada-002"):
        super().__init__(project_path, db_name, platform, api_key, embedding_model)
        self.collection_name = 'code_tree_memory'
        self.embedder = OpenAI(api_key=api_key)
        

    def add_code_files(self, directory: str, exclude_prefix: List[str] = ["workplace_"]):
        """
        将指定目录下的所有代码文件添加到内存中。
        
        Args:
            directory (str): 要添加的代码文件所在的目录路径
        """
        tree_sitter_parent_dir = os.path.dirname(os.getcwd())
        # Build Tree sitter Parser object
        Language.build_library(
            f"{tree_sitter_parent_dir}/my-languages.so",
            [
                f"{tree_sitter_parent_dir}/tree-sitter-python",
            ],
        )
        parser = CodeParser(
            language="python",
            node_types=["class_definition", "function_definition"],
            path_to_object_file=tree_sitter_parent_dir,
        )
        logger.info("Parsing Code...")
        parsed_snippets = parser.parse_directory(
            directory
        )
        snippet_texts = list(map(lambda x: x.snippet.decode("ISO-8859-1"), parsed_snippets))
        embedded_texts = self.embedder.embeddings.create(input=snippet_texts, model="text-embedding-3-small").data
        embedded_snippets = []
        for code_text, embedding, snippet in zip(
            snippet_texts, embedded_texts, parsed_snippets
        ):
            snippet.snippet = code_text
            snippet.embedding = embedding.embedding
            embedded_snippets.append(snippet)

        # Convert Snippets to DataFrame for ChromaDB Ingestion
        data = pd.DataFrame(to_dataframe_row(embedded_snippets))
        collection = self.client.get_or_create_collection(
            name=self.collection_name, metadata={"hnsw:space": "cosine"}
        )
        logger.info(
            f"Adding {data.shape[0]} Code snippets and embedding to "
            "local chroma db collection..."
        )
        collection.add(
            documents=data["snippets"].tolist(),
            embeddings=data["embeddings"].tolist(),
            metadatas=data["metadatas"].tolist(),
            ids=data["ids"].tolist(),
        )
        

    def query_code(self, query_text: str, n_results: int = 5) -> List[Dict]:
        """
        Query the code memory.
        
        Args:
            query_text (str): The query text
            n_results (int): The number of results to return
        
        Returns:
            List[Dict]: The query results list
        """
        query_embedding = self.embedder.embeddings.create(input=[query_text], model="text-embedding-3-small").data[0].embedding
        results = self.client.get_or_create_collection(self.collection_name).query(query_embeddings=[query_embedding], n_results=n_results)
        return [
            {
                "file": metadata['filenames'],
                "content": doc
            }
            for doc, metadata in zip(results['documents'][0], results['metadatas'][0])
        ]
class DummyReranker(Reranker):
    def __init__(self, model: str = None) -> None:
        super().__init__(model)
    def rerank(self, query_results: List[Dict]) -> List[Dict]:
        wrapped_reranked_results = "[Referenced code files]:"
        result_path = []
        for result in query_results:
            if result['file'] in result_path:
                continue
            else:
                result_path.append(result['file'])
            wrapped_reranked_results += f"Code path: {result['file']}\n"
            wrapped_reranked_results += f"Code content:\n{result['content']}...\n"
            wrapped_reranked_results += "---\n"
        return wrapped_reranked_results

# 使用示例
if __name__ == "__main__":
    code_memory = CodeTreeMemory(project_path = './code_db', db_name='code_tree', platform='OpenAI', api_key='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')
    
    # 添加代码文件到内存
    code_memory.add_code_files("/Users/tangjiabin/Documents/reasoning/SelfAgent/workplace_test/SelfAgent", exclude_prefix=['workplace_', '__pycache__', 'code_db', '.git'])
    
    # 查询代码
    query_results = code_memory.query_code("The definition of BaseAction", n_results=10)
    
    for result in query_results:
        print(f"File: {result['file']}")
        print(f"Content: {result['content'][:100]}...")  # 只打印前100个字符
        print("---")