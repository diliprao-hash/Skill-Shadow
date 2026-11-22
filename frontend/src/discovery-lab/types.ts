export type Category = {
  id: string
  name: string
  description: string
  icon: string
  accent: string
  question_count: number
  available: boolean
}
export type Question = {
  id: number
  question: string
  options: string[]
}
export type QuestionResponse = { category_id: string; questions: Question[] }
export type AnswerReview = {
  question_id: number
  question: string
  selected_index: number
  correct_index: number
  correct_answer: string
  is_correct: boolean
  explanation: string
}
export type ScoreResult = {
  category_id: string
  correct: number
  total: number
  score_percent: number
  review: AnswerReview[]
  disclaimer: string
}
