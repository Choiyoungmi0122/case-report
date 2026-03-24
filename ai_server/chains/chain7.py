try:
    from schemas.case_schema import Chain3Output, Chain7Output
    from prompts.chain7_prompt import chain7SystemPrompt
except ModuleNotFoundError:
    from ai_server.schemas.case_schema import Chain3Output, Chain7Output
    from ai_server.prompts.chain7_prompt import chain7SystemPrompt

import json
import os
from openai import OpenAI


def run_chain7(final_draft: Chain3Output) -> Chain7Output:
    """
    Chain7
    역할:
    - 최종 구조화 draft를 섹션별 최종 문안으로 합성
    - 입력 정보 외 추론/추가 금지
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4.1"),
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": chain7SystemPrompt,
            },
            {
                "role": "user",
                "content": json.dumps(final_draft.model_dump(), ensure_ascii=False),
            },
        ],
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content

    print("===== CHAIN7 RAW =====")
    print(content)
    print("======================")

    parsed_json = json.loads(content)
    return Chain7Output.model_validate(parsed_json)
