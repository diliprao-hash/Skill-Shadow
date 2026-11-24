"""Career-topic practice assessment API. Does not alter career matching or save results."""
import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/career-assessments", tags=["Career Assessments"])
BANK_PATH = Path(__file__).resolve().with_name("questions.json")


@lru_cache(maxsize=1)
def _bank():
    return json.loads(BANK_PATH.read_text(encoding="utf-8"))


class Submission(BaseModel):
    topic_id: str = Field(min_length=1, max_length=100)
    answers: dict[int, int]


@router.get("/topics")
def list_topics():
    return [
        {"id": topic_id, "title": data["title"], "module_id": data["module_id"],
         "description": data["description"], "question_count": len(data["questions"])}
        for topic_id, data in _bank().items()
    ]


@router.get("/questions/{topic_id}")
def get_questions(topic_id: str):
    data = _bank().get(topic_id)
    if data is None:
        raise HTTPException(status_code=404, detail="This topic assessment is not available yet")
    return {"topic_id": topic_id, "title": data["title"],
            "questions": [{"id": q["id"], "question": q["question"],
                           "options": q["options"]} for q in data["questions"]]}


@router.post("/submit")
def score_answers(payload: Submission):
    data = _bank().get(payload.topic_id)
    if data is None:
        raise HTTPException(status_code=404, detail="This topic assessment is not available yet")
    questions = data["questions"]
    if set(payload.answers) != {q["id"] for q in questions}:
        raise HTTPException(status_code=422, detail="Answer every question exactly once")
    for q in questions:
        selected = payload.answers[q["id"]]
        # bool is an int subclass in Python; Pydantic normally rejects bool for int here.
        if not 0 <= selected < len(q["options"]):
            raise HTTPException(status_code=422, detail=f"Invalid option for question {q['id']}")
    review = [{"question_id": q["id"], "question": q["question"],
               "selected_index": payload.answers[q["id"]],
               "correct_index": q["answer_index"],
               "correct_answer": q["options"][q["answer_index"]],
               "is_correct": payload.answers[q["id"]] == q["answer_index"],
               "explanation": q["explanation"]} for q in questions]
    correct = sum(item["is_correct"] for item in review)
    return {"topic_id": payload.topic_id, "correct": correct, "total": len(questions),
            "score_percent": round(100 * correct / len(questions)),
            "review": review,
            "disclaimer": "Educational practice only. Results do not certify skills, qualify students for regulated professions, or measure career suitability."}
