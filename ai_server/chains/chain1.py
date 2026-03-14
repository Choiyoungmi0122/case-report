"""
Chain 1: Extract structured information from Korean medical case reports.
Uses LangChain ChatOpenAI if available; otherwise falls back to OpenAI SDK.
"""

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


# --- Output schema (Pydantic) ---

class PatientInfo(BaseModel):
    age: str = Field(description="Patient age from the case (e.g. '45세', '' if not mentioned)")
    sex: str = Field(description="Patient sex from the case (e.g. '남', '여', '' if not mentioned)")


class TimelineItem(BaseModel):
    date: str = Field(description="Date or visit label (e.g. '2024-01-15', '초진', '재진 1회')")
    events: List[str] = Field(description="Medical events or findings for this date/visit")

class Chain1Output(BaseModel):
    patient_info: PatientInfo = Field(description="Patient demographics")
    timeline: List[TimelineItem] = Field(description="Chronological timeline by date/visit")
    symptoms: List[str] = Field(description="Symptoms mentioned in the case (e.g. 두통, 어지러움)")
    diagnosis: List[str] = Field(description="Diagnosis terms (e.g. 화병, 허혈)")
    treatment: List[str] = Field(description="Treatments (e.g. 침치료, 혈위, 한약)")


# --- Prompt ---

SYSTEM_PROMPT = """You are a medical information extraction assistant. Your task is to read Korean medical case reports and extract structured information into JSON.

Rules:
- Extract ONLY information explicitly stated in the text. Do not infer or add anything.
- For patient_info: use empty string "" if age or sex is not mentioned.
- For timeline: list each date or visit section (e.g. 초진, 재진, 방문일) with the corresponding events/findings. Preserve chronological order.
- For symptoms: list each symptom mentioned (e.g. 두통, 어지러움, 피로감).
- For diagnosis: list diagnosis terms used in the case (e.g. 화병, 허혈성 심질환, 소화불량).
- For treatment: list treatments mentioned (e.g. 침치료, 혈위, 한약, 물리치료). Use the exact terms from the text when possible.
- All list fields may be empty arrays if no relevant information is found.
- Respond only with valid JSON matching the required schema."""

USER_PROMPT_TEMPLATE = """다음 한국어 의료 케이스 기록에서 정보를 추출하여 아래 JSON 구조로 반환하세요.

---
의료 기록:
{text}
---

JSON 구조:
- patient_info: age, sex (없으면 빈 문자열 "")
- timeline: date(날짜/방문), events(해당 시점의 진료 내용) 배열
- symptoms: 증상 목록
- diagnosis: 진단명 목록 (예: 화병)
- treatment: 치료 목록 (예: 침치료, 혈위, 한약)"""


# --- Chain ---

def _empty_result() -> dict:
    return {
        "patient_info": {"age": "", "sex": ""},
        "timeline": [],
        "symptoms": [],
        "diagnosis": [],
        "treatment": [],
    }


def _build_langchain_chain():
    if not _LANGCHAIN_AVAILABLE:
        raise RuntimeError("LangChain is not available. Install langchain-openai and langchain-core.")

    model = os.environ.get("OPENAI_MODEL", os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"))
    llm = ChatOpenAI(
        model=model,
        temperature=0,
        api_key=os.environ.get("OPENAI_API_KEY"),
    )

    structured_llm = llm.with_structured_output(Chain1Output)
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            ("human", USER_PROMPT_TEMPLATE),
        ]
    )
    return prompt | structured_llm


def _invoke_with_openai_sdk(text: str) -> dict:
    if not _OPENAI_AVAILABLE:
        raise RuntimeError(
            "OpenAI SDK is not installed. Run `pip install -r requirements.txt` in ai_server."
        )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.environ.get("OPENAI_MODEL", os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"))
    client = OpenAI(api_key=api_key)

    user_prompt = USER_PROMPT_TEMPLATE.format(text=text)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("Empty response from OpenAI.")

    data = json.loads(content)
    validated = Chain1Output.model_validate(data)
    return validated.model_dump(mode="json")


# Lazy init so env can be set before first request
_chain = None


def _get_chain():
    global _chain
    if _chain is None:
        _chain = _build_langchain_chain()
    return _chain


def invoke(input_dict: dict) -> dict:
    """
    Extract structured information from Korean medical case text.

    Args:
        input_dict: Must contain "text" or "input_text" with the raw medical case string.

    Returns:
        Dict with keys: patient_info, timeline, symptoms, diagnosis, treatment.
    """
    text = input_dict.get("text", "") or input_dict.get("input_text", "")
    if not text or not text.strip():
        return _empty_result()

    # Default to OpenAI SDK to avoid extra dependencies/noisy warnings.
    # If you explicitly want LangChain, set CHAIN1_ENGINE=langchain.
    engine = (os.environ.get("CHAIN1_ENGINE") or "openai").strip().lower()

    if engine == "langchain":
        if not _LANGCHAIN_AVAILABLE:
            raise RuntimeError(
                "CHAIN1_ENGINE=langchain but LangChain is not installed. "
                "Install langchain-openai and langchain-core (or set CHAIN1_ENGINE=openai)."
            )
        chain = _get_chain()
        result: Chain1Output = chain.invoke({"text": text})
        return result.model_dump(mode="json")

    # engine == "openai" (default)
    return _invoke_with_openai_sdk(text)


class Chain1:
    """Chain1: extract structured info from Korean medical case text."""

    def invoke(self, input_dict: dict) -> dict:
        return invoke(input_dict)


chain1 = Chain1()
