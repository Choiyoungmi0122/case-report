try:
    from schemas.case_schema import Chain3Output, Chain6Output, QAItem
    from prompts.chain6_prompt import chain6SystemPrompt
except ModuleNotFoundError:
    from ai_server.schemas.case_schema import Chain3Output, Chain6Output, QAItem
    from ai_server.prompts.chain6_prompt import chain6SystemPrompt

import json
import os
from openai import OpenAI


def run_chain6(current_draft: Chain3Output, qa_item: QAItem) -> Chain6Output:
    """
    Chain6
    역할:
    - Draft + single clarification answer -> updated draft
    - 추론 없이 답변에 명시된 정보만 반영
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    client = OpenAI(api_key=api_key)

    payload = {
        "draft": current_draft.model_dump(),
        "qa": qa_item.model_dump(),
    }

    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4.1"),
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": chain6SystemPrompt,
            },
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False),
            },
        ],
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content

    print("===== CHAIN6 RAW =====")
    print(content)
    print("======================")

    parsed_json = json.loads(content)
    return Chain6Output.model_validate(parsed_json)
