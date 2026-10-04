type OpenAIStyleError = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  type?: string;
  request_id?: string;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  issues?: Array<{
    path?: Array<string | number>;
    message?: string;
    code?: string;
  }>;
};

function pickMessage(error: OpenAIStyleError): string {
  return (
    error?.error?.message ||
    error?.message ||
    'Unknown error'
  );
}

export function summarizeError(error: unknown): string {
  const value = (error || {}) as OpenAIStyleError;
  const message = pickMessage(value);
  const status = value?.status ? `status=${value.status}` : null;
  const code = value?.error?.code || value?.code;
  const type = value?.error?.type || value?.type || value?.name;
  const requestId = value?.request_id ? `request_id=${value.request_id}` : null;

  if (code === 'insufficient_quota') {
    return [
      'OpenAI quota exceeded',
      status,
      'code=insufficient_quota',
      requestId
    ]
      .filter(Boolean)
      .join(' | ');
  }

  if (value?.name === 'ZodError' && Array.isArray(value.issues) && value.issues.length > 0) {
    const preview = value.issues
      .slice(0, 2)
      .map((issue) => `${(issue.path || []).join('.')} -> ${issue.message || issue.code || 'invalid'}`)
      .join(' ; ');

    return [
      'ZodError',
      `issues=${value.issues.length}`,
      `details=${preview}`
    ]
      .filter(Boolean)
      .join(' | ');
  }

  return [
    type || 'Error',
    status,
    code ? `code=${code}` : null,
    requestId,
    `message=${message}`
  ]
    .filter(Boolean)
    .join(' | ');
}

export function shouldRetryLLMError(error: unknown): boolean {
  const value = (error || {}) as OpenAIStyleError;
  const status = value?.status;
  const code = value?.error?.code || value?.code;

  if (code === 'insufficient_quota' || code === 'missing_api_key') return false;
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;

  return true;
}
