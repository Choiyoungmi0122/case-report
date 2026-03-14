import json
from pathlib import Path
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from chains.chain1 import invoke as run_chain1
from chains.chain2 import run_chain2
from chains.chain3 import run_chain3

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


# @app.post("/test_chain1")
# async def test_chain1(request: dict):
#     try:
#         # Chain1
#         chain1_result = run_chain1({"text": request["text"]})

#         print("===== CHAIN1 OUTPUT =====")
#         print(chain1_result)
#         print("========================")

#         # Chain2
#         chain2_result = run_chain2(chain1_result)

#         print("===== CHAIN2 OUTPUT =====")
#         print(chain2_result)
#         print("========================")

#         return {
#             "chain1": chain1_result,
#             "chain2": chain2_result
#         }

#     except Exception as e:
#         import traceback
#         print("===== ERROR =====")
#         traceback.print_exc()
#         print("=================")

#         return {"error": str(e)}

@app.post("/test_chain1")
async def test_chain1(request: dict):
    try:

        chain1_result = run_chain1({"text": request["text"]})

        print("===== CHAIN1 OUTPUT =====")
        print(chain1_result)

        chain2_result = run_chain2(chain1_result)

        print("===== CHAIN2 OUTPUT =====")
        print(chain2_result)

        chain3_result = run_chain3(chain2_result)

        print("===== CHAIN3 OUTPUT =====")
        print(chain3_result)

        return {
            "chain1": chain1_result,
            "chain2": chain2_result,
            "chain3": chain3_result
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}