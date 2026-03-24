# [Chain4] chains/chain4.py

try:
    from schemas.case_schema import Chain4Output
    from prompts.chain4_prompt import chain4SystemPrompt
except ModuleNotFoundError:
    from ai_server.schemas.case_schema import Chain4Output
    from ai_server.prompts.chain4_prompt import chain4SystemPrompt

import json
import os
from openai import OpenAI


def run_chain4(chain3_result):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    client = OpenAI(api_key=api_key)

    payload = chain3_result.model_dump()

    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4.1"),
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": chain4SystemPrompt
            },
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False)
            }
        ],
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    print("===== CHAIN4 INPUT =====")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print("===== CHAIN4 RAW =====")
    print(content)
    print("========================")

    parsed_json = json.loads(content)
    result = Chain4Output.model_validate(parsed_json)

    return result