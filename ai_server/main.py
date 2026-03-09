import json
from pathlib import Path
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel

from dotenv import load_dotenv

try:
    # When running from: ai_server> uvicorn main:app ...
    from chains.chain1 import chain1  # type: ignore
except ModuleNotFoundError:
    # When running from repo root: uvicorn ai_server.main:app ...
    from ai_server.chains.chain1 import chain1  # type: ignore

BASE_DIR = Path(__file__).resolve().parent
# Load env from common locations (ai_server/.env, backend/.env, repo root/.env)
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / "backend" / ".env")
load_dotenv(BASE_DIR.parent / ".env")

app = FastAPI(title="AI Server", description="LLM chain for medical case extraction")


class TestChain1Request(BaseModel):
    text: str


@app.get("/")
async def root():
    return {
        "service": "AI Server",
        "docs": "/docs",
        "test_chain1": "POST /test_chain1",
        "body_example": {"text": "medical case text"},
    }


@app.post("/test_chain1")
async def test_chain1(data: TestChain1Request):
    try:
        result = chain1.invoke({"text": data.text})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    print("\n===== CHAIN1 OUTPUT =====")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("========================\n")

    return result
