from openai import AsyncOpenAI
from schemas.case_schema import Chain1Output, Chain2Output
from prompts.chain2_prompt import chain2SystemPrompt

import json

import json
import os
from typing import List

from pydantic import BaseModel, Field

try:
    from langchain_openai import ChatOpenAI  # type: ignore
    from langchain_core.prompts import ChatPromptTemplate  # type: ignore

    _LANGCHAIN_AVAILABLE = True
except Exception:
    _LANGCHAIN_AVAILABLE = False

try:
    from openai import OpenAI  # type: ignore

    _OPENAI_AVAILABLE = True
except Exception:
    _OPENAI_AVAILABLE = False




def run_chain2(chain1_result: Chain1Output) -> Chain2Output:
    """
    Chain2
    역할:
    - Chain1 결과 JSON을 받아 구조를 재정리
    - 해석 / 추론 없이 단순 구조화
    """

    input_json = chain1_result

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-4.1",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": chain2SystemPrompt
            },
            {
                "role": "user",
                "content": json.dumps(input_json, ensure_ascii=False)
            }
        ],
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    
    print("===== CHAIN2 RAW =====")
    print(content)
    print("======================")
    
    parsed_json = json.loads(content)

    result = Chain2Output.model_validate(parsed_json)

    return result
