# [Chain5] chains/chain5.py

try:
    from schemas.case_schema import Chain5Output
    from prompts.chain5_prompt import chain5SystemPrompt
except ModuleNotFoundError:
    from ai_server.schemas.case_schema import Chain5Output
    from ai_server.prompts.chain5_prompt import chain5SystemPrompt

import json
import os
from openai import OpenAI


def run_chain5(chain3_result, chain4_result):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    client = OpenAI(api_key=api_key)

    payload = {
        "draft": chain3_result.model_dump(),
        "missing": chain4_result.model_dump()
    }

    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4.1"),
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": chain5SystemPrompt
            },
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False)
            }
        ],
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    print("===== CHAIN5 INPUT =====")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print("===== CHAIN5 RAW =====")
    print(content)
    print("========================")

    parsed_json = json.loads(content)
    result = Chain5Output.model_validate(parsed_json)

    return result