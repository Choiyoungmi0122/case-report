from schemas.case_schema import Chain3Output
from prompts.chain3_prompt import chain3SystemPrompt

import json
import os
from openai import OpenAI


def run_chain3(chain2_result):

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
                "content": chain3SystemPrompt
            },
            {
                "role": "user",
                "content": json.dumps(chain2_result.model_dump(), ensure_ascii=False)
            }
        ],
        response_format={"type": "json_object"}
    )

    content = response.choices[0].message.content

    print("===== CHAIN3 RAW =====")
    print(content)
    print("======================")

    parsed_json = json.loads(content)

    result = Chain3Output.model_validate(parsed_json)

    return result