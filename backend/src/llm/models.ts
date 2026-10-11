/**
 * 체인별 모델 선택. chains.ts 에서 분리해 프롬프트 레지스트리(promptRegistry.ts)가
 * 순환 참조 없이 "이 체인이 지금 어떤 모델을 쓰는가"를 알 수 있게 한다.
 *
 * 실험용 Write 체인은 기존 키를 빌려 쓴다: SW-Q2 → chain5, SW-D·SW-R → chain6, SW-C → chain4.
 * 따라서 CHAIN5_MODEL 을 바꾸면 SW-Q2 도 바뀐다.
 */
export const FAST_LLM_MODEL = process.env.FAST_LLM_MODEL || 'gpt-4.1-mini';
export const QUALITY_LLM_MODEL = process.env.QUALITY_LLM_MODEL || 'gpt-4.1';

export function getModelForChain(chainName: string): string {
  switch (chainName) {
    case 'chain1':
    case 'chain2':
    case 'chain4':
    case 'chain5':
      return process.env[`${chainName.toUpperCase()}_MODEL`] || FAST_LLM_MODEL;
    case 'chain3':
    case 'chain6':
    case 'chain7':
    case 'review':
      return process.env[`${chainName.toUpperCase()}_MODEL`] || QUALITY_LLM_MODEL;
    default:
      return process.env.LLM_MODEL || QUALITY_LLM_MODEL;
  }
}
