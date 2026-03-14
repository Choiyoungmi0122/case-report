from chains.chain1 import run_chain1
from chains.chain2 import run_chain2


async def run_case_pipeline(case_text: str):

    # Chain1 실행
    chain1_result = await run_chain1(case_text)

    # Chain2 실행
    chain2_result = await run_chain2(chain1_result)

    return chain2_result