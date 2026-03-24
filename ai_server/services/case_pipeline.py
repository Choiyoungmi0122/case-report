from pydantic import ValidationError
from typing import List, Dict, Any

try:
    from chains.chain1 import invoke as run_chain1
    from chains.chain2 import run_chain2
    from chains.chain3 import run_chain3
    from chains.chain4 import run_chain4
    from chains.chain5 import run_chain5
    from chains.chain6 import run_chain6
    from chains.chain7 import run_chain7
    from schemas.case_schema import QAItem
except ModuleNotFoundError:
    from ai_server.chains.chain1 import invoke as run_chain1
    from ai_server.chains.chain2 import run_chain2
    from ai_server.chains.chain3 import run_chain3
    from ai_server.chains.chain4 import run_chain4
    from ai_server.chains.chain5 import run_chain5
    from ai_server.chains.chain6 import run_chain6
    from ai_server.chains.chain7 import run_chain7
    from ai_server.schemas.case_schema import QAItem


def run_case_pipeline(case_text: str, qa_items: List[Dict[str, str]] | None = None):
    """
    Run full case pipeline:
    Chain1 -> Chain2 -> Chain3 -> Chain4 -> Chain5 -> Chain6(interactive) -> Chain7
    """
    qa_items = qa_items or []

    chain1_result = run_chain1({"text": case_text})
    chain2_result = run_chain2(chain1_result)
    chain3_result = run_chain3(chain2_result)
    chain4_result = run_chain4(chain3_result)
    chain5_result = run_chain5(chain3_result, chain4_result)

    current_draft = chain3_result
    interactive_trace: List[Dict[str, Any]] = []
    latest_chain4 = chain4_result
    latest_chain5 = chain5_result

    for raw_item in qa_items:
        try:
            qa_item = QAItem.model_validate(raw_item)
        except ValidationError:
            continue

        chain6_result = run_chain6(current_draft, qa_item)
        current_draft = chain6_result
        latest_chain4 = run_chain4(current_draft)
        latest_chain5 = run_chain5(current_draft, latest_chain4)
        interactive_trace.append(
            {
                "qa": qa_item.model_dump(),
                "chain6": chain6_result.model_dump(),
                "chain4_after_chain6": latest_chain4.model_dump(),
                "chain5_after_chain6": latest_chain5.model_dump(),
            }
        )

    chain7_result = run_chain7(current_draft)
    return {
        "chain1": chain1_result,
        "chain2": chain2_result.model_dump(),
        "chain3": chain3_result.model_dump(),
        "chain4": latest_chain4.model_dump(),
        "chain5": latest_chain5.model_dump(),
        "interactive_trace": interactive_trace,
        "chain7": chain7_result.model_dump(),
    }