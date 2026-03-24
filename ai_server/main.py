from pathlib import Path
import sys
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
if str(REPO_ROOT) not in sys.path:
    # Ensure `ai_server.*` package imports work during uvicorn reload subprocesses.
    sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False

try:
    # Running from ai_server directory
    from chains.chain1 import invoke as run_chain1
    from chains.chain2 import run_chain2
    from chains.chain3 import run_chain3
    from chains.chain4 import run_chain4
    from chains.chain5 import run_chain5
    from chains.chain6 import run_chain6
    from chains.chain7 import run_chain7
    from schemas.case_schema import Chain3Output, QAItem
    from services.case_pipeline import run_case_pipeline
except ModuleNotFoundError:
    # Running from repository root
    from ai_server.chains.chain1 import invoke as run_chain1
    from ai_server.chains.chain2 import run_chain2
    from ai_server.chains.chain3 import run_chain3
    from ai_server.chains.chain4 import run_chain4
    from ai_server.chains.chain5 import run_chain5
    from ai_server.chains.chain6 import run_chain6
    from ai_server.chains.chain7 import run_chain7
    from ai_server.schemas.case_schema import Chain3Output, QAItem
    from ai_server.services.case_pipeline import run_case_pipeline

# Load env from common locations (ai_server/.env, backend/.env, repo root/.env)
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / "backend" / ".env")
load_dotenv(BASE_DIR.parent / ".env")

app = FastAPI(title="AI Server", description="LLM chain for medical case extraction")


class QARequestItem(BaseModel):
    question: str
    answer: str


class PipelineStartRequest(BaseModel):
    text: str


class PipelineAnswerRequest(BaseModel):
    current_draft: Dict[str, Any]
    question: str
    answer: str
    refresh_missing: bool = True


class PipelineRunFullRequest(BaseModel):
    text: str
    qa_items: List[QARequestItem] = []


@app.get("/")
async def root():
    return {
        "service": "AI Server",
        "docs": "/docs",
        "pipeline_start": "POST /pipeline/start",
        "pipeline_answer": "POST /pipeline/answer",
        "pipeline_run_full": "POST /pipeline/run-full",
    }


@app.post("/pipeline/start")
async def pipeline_start(request: PipelineStartRequest):
    try:
        chain1_result = run_chain1({"text": request.text})
        chain2_result = run_chain2(chain1_result)
        chain3_result = run_chain3(chain2_result)
        chain4_result = run_chain4(chain3_result)
        chain5_result = run_chain5(chain3_result, chain4_result)

        return {
            "chain1": chain1_result,
            "chain2": chain2_result.model_dump(),
            "chain3": chain3_result.model_dump(),
            "chain4": chain4_result.model_dump(),
            "chain5": chain5_result.model_dump(),
            "is_complete": len(chain4_result.missing) == 0,
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/answer")
async def pipeline_answer(request: PipelineAnswerRequest):
    """
    Interactive step:
    Draft + one Q&A -> updated draft (Chain6).
    Optionally re-check missing (Chain4/5); Chain7 is not run here.
    """
    try:
        current_draft = Chain3Output.model_validate(request.current_draft)
        qa_item = QAItem(question=request.question, answer=request.answer)

        chain6_result = run_chain6(current_draft, qa_item)
        if not request.refresh_missing:
            return {
                "chain6": chain6_result.model_dump(),
                "chain4": None,
                "chain5": None,
                "chain7": None,
                "is_complete": False,
                "lightweight": True,
            }

        chain4_result = run_chain4(chain6_result)
        chain5_result = run_chain5(chain6_result, chain4_result)

        is_complete = len(chain4_result.missing) == 0

        return {
            "chain6": chain6_result.model_dump(),
            "chain4": chain4_result.model_dump(),
            "chain5": chain5_result.model_dump(),
            "chain7": None,
            "is_complete": is_complete,
            "lightweight": False,
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/run-full")
async def pipeline_run_full(request: PipelineRunFullRequest):
    """
    One-shot execution:
    Chain1 -> Chain2 -> Chain3 -> Chain4 -> Chain5
    -> Chain6 반복(qa_items) -> Chain7
    """
    try:
        result = run_case_pipeline(
            case_text=request.text,
            qa_items=[item.model_dump() for item in request.qa_items],
        )
        return result
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/test_chain1")
async def test_chain1(request: PipelineRunFullRequest):
    """
    Backward compatible alias for existing local testing.
    """
    return await pipeline_run_full(request)