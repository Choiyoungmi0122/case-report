from pydantic import BaseModel, Field
from typing import List


# -------------------------
# Chain1 Schema
# -------------------------

class PatientInfo(BaseModel):
    age: str = Field(description="Patient age mentioned in the case text")
    sex: str = Field(description="Patient sex mentioned in the case text")


class TimelineItem(BaseModel):
    date: str = Field(description="Date or visit label (e.g., 2023-03-14, 초진, 재진)")
    events: List[str] = Field(description="Medical events or findings mentioned for this visit")


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
    physical: List[str] = Field(description="Physical symptoms explicitly mentioned")
    sleep: List[str] = Field(description="Sleep related symptoms")
    emotional: List[str] = Field(description="Emotional or psychological symptoms")


class TreatmentGroup(BaseModel):
    type: List[str] = Field(description="Treatment types such as acupuncture, herbal medicine")
    acupoints: List[str] = Field(description="Acupuncture points mentioned in the text")


class TimelineStructuredItem(BaseModel):
    date: str = Field(description="Date or visit label")
    visit_type: str = Field(description="Visit type such as initial_visit or follow_up")
    events: List[str] = Field(description="Events mentioned in the case text")


class Chain2Output(BaseModel):
    patient_info: PatientInfo
    symptoms: SymptomGroup
    diagnosis: List[str]
    treatment: TreatmentGroup
    timeline: List[TimelineStructuredItem]
# -------------------------
# Chain3 Schema
# -------------------------

from typing import Dict, Any


class DiagnosticAssessment(BaseModel):
    diagnosis: List[str]
    missing: List[str]


class TherapeuticIntervention(BaseModel):
    treatment_type: List[str]
    acupoints: List[str]
    frequency: str | None = None
    missing: List[str]


class PatientPerspective(BaseModel):
    missing: List[str]



class Chain3Output(BaseModel):

    patient_information: Dict[str, Any]

    clinical_findings: Dict[str, Any]

    timeline: List[Dict[str, Any]]

    diagnostic_assessment: Dict[str, Any]

    therapeutic_intervention: Dict[str, Any]

    follow_up_outcomes: Dict[str, Any]

    patient_perspective: Any

    missing: List[str] | None = None

    clarification_questions: List[str]