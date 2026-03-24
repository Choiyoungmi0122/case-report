import json
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any


# -------------------------
# Chain1 Schema
# -------------------------

class PatientInfo(BaseModel):
    age: str
    sex: str


class TimelineItem(BaseModel):
    date: str
    events: List[str]


class Chain1Output(BaseModel):
    patient_info: PatientInfo
    timeline: List[TimelineItem]
    symptoms: List[str]
    diagnosis: List[str]
    treatment: List[str]


# -------------------------
# Chain2 Schema
# -------------------------

class SymptomGroup(BaseModel):
    physical: List[str]
    sleep: List[str]
    emotional: List[str]


class TreatmentGroup(BaseModel):
    type: List[str]
    acupoints: List[str]


class TimelineStructuredItem(BaseModel):
    date: str
    visit_type: str
    events: List[str]


class Chain2Output(BaseModel):
    patient_info: PatientInfo
    symptoms: SymptomGroup
    diagnosis: List[str]
    treatment: TreatmentGroup
    timeline: List[TimelineStructuredItem]


def _flatten_strings(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        items: List[str] = []
        for item in value:
            items.extend(_flatten_strings(item))
        return items
    if isinstance(value, dict):
        if isinstance(value.get("reported_experiences"), list):
            return _flatten_strings(value.get("reported_experiences"))
        if isinstance(value.get("reported_experiences"), str):
            return _flatten_strings(value.get("reported_experiences"))
        if isinstance(value.get("text"), str):
            text_value = value.get("text", "").strip()
            if text_value.startswith("{") or text_value.startswith("["):
                try:
                    return _flatten_strings(json.loads(text_value))
                except Exception:
                    return [text_value] if text_value else []
        items: List[str] = []
        for item in value.values():
            items.extend(_flatten_strings(item))
        return items
    return []


def _normalize_patient_perspective(value: Any) -> Dict[str, List[str]]:
    if value is None or value == "":
        return {"reported_experiences": []}
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {"reported_experiences": []}
        if text.startswith("{") or text.startswith("["):
            try:
                return _normalize_patient_perspective(json.loads(text))
            except Exception:
                return {"reported_experiences": [text]}
        return {"reported_experiences": [text]}
    if isinstance(value, list):
        return {"reported_experiences": _flatten_strings(value)}
    if isinstance(value, dict):
        if "reported_experiences" in value:
            return {"reported_experiences": _flatten_strings(value.get("reported_experiences"))}
        return {"reported_experiences": _flatten_strings(value)}
    return {"reported_experiences": _flatten_strings(value)}


class PatientPerspective(BaseModel):
    reported_experiences: List[str] = Field(default_factory=list)

    @field_validator("reported_experiences", mode="before")
    @classmethod
    def normalize_reported_experiences(cls, value: Any) -> List[str]:
        return _flatten_strings(value)


# -------------------------
# Chain3 Schema (🔥 수정됨)
# -------------------------

class Chain3Output(BaseModel):
    patient_information: Dict[str, Any]
    clinical_findings: Dict[str, Any]
    timeline: List[Dict[str, Any]]
    diagnostic_assessment: Dict[str, Any]
    therapeutic_intervention: Dict[str, Any]
    follow_up_outcomes: Dict[str, Any]
    patient_perspective: PatientPerspective = Field(default_factory=PatientPerspective)

    @field_validator("patient_perspective", mode="before")
    @classmethod
    def normalize_patient_perspective(cls, value: Any) -> Dict[str, List[str]]:
        return _normalize_patient_perspective(value)


# -------------------------
# Chain4 Schema (🔥 NEW)
# -------------------------

class Chain4Output(BaseModel):
    missing: List[str]

class Chain5Output(BaseModel):
    clarification_questions: List[str]


# -------------------------
# Chain6 / Chain7 Schema
# -------------------------

class QAItem(BaseModel):
    question: str
    answer: str


class Chain6Output(BaseModel):
    patient_information: Dict[str, Any]
    clinical_findings: Dict[str, Any]
    timeline: List[Dict[str, Any]]
    diagnostic_assessment: Dict[str, Any]
    therapeutic_intervention: Dict[str, Any]
    follow_up_outcomes: Dict[str, Any]
    patient_perspective: PatientPerspective = Field(default_factory=PatientPerspective)

    @field_validator("patient_perspective", mode="before")
    @classmethod
    def normalize_patient_perspective(cls, value: Any) -> Dict[str, List[str]]:
        return _normalize_patient_perspective(value)


class Chain7Sections(BaseModel):
    patient_information: str
    clinical_findings: str
    timeline: str
    diagnostic_assessment: str
    therapeutic_intervention: str
    follow_up_outcomes: str
    patient_perspective: str


class Chain7Output(BaseModel):
    final_sections: Chain7Sections
    final_markdown: str