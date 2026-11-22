import type { Category, QuestionResponse, ScoreResult } from './types'

// In dev, Vite proxies /api/discovery to the FastAPI server.
// When embedding into SkillShadow, point VITE_API_BASE_URL to FastAPI
// or let your existing Node.js gateway forward these requests.
const BASE="";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new Error('Cannot reach the Discovery Lab API. Start the FastAPI backend on port 8000.')
  }
  if (!response.ok) {
    let detail = 'Something went wrong. Please try again.'
    try {
      const body = await response.json() as { detail?: string }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* response may not be JSON */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const discoveryApi = {
  categories: () => request<Category[]>('/api/discovery/categories'),
  questions: (categoryId: string) =>
    request<QuestionResponse>(`/api/discovery/questions?category_id=${encodeURIComponent(categoryId)}`),
  submit: (categoryId: string, answers: Record<number, number>) =>
    request<ScoreResult>('/api/discovery/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId, answers }),
    }),
}
