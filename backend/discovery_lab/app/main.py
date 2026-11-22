"""SkillShadow Discovery Lab FastAPI service (MVP)."""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .questions import CATEGORIES, QUESTIONS

app = FastAPI(title="SkillShadow Discovery Lab", version="0.1.0")

origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class Submission(BaseModel):
    category_id: str
    answers: dict[int, int] = Field(description="Question ID to selected option index (0-based)")


@app.get("/api/discovery/health")
def health():
    return {"status": "ok", "service": "discovery-lab"}


@app.get("/api/discovery/categories")
def categories():
    return [
        {**category, "question_count": len(QUESTIONS.get(category["id"], [])), "available": bool(QUESTIONS.get(category["id"]))}
        for category in CATEGORIES
    ]


@app.get("/api/discovery/questions")
def questions(category_id: str = "logical_reasoning"):
    bank = QUESTIONS.get(category_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Assessment is not available yet")
    # Never include answers in the question-delivery response.
    return {
        "category_id": category_id,
        "questions": [
            {"id": question["id"], "question": question["question"], "options": question["options"]}
            for question in bank
        ],
    }


@app.post("/api/discovery/submit")
def submit(submission: Submission):
    bank = QUESTIONS.get(submission.category_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Assessment is not available yet")

    expected_ids = {q["id"] for q in bank}
    if set(submission.answers) != expected_ids:
        raise HTTPException(status_code=422, detail="Answer every assessment question exactly once")

    for question in bank:
        selected = submission.answers[question["id"]]
        if not 0 <= selected < len(question["options"]):
            raise HTTPException(status_code=422, detail=f"Invalid option for question {question['id']}")

    review = [
        {
            "question_id": question["id"],
            "question": question["question"],
            "selected_index": submission.answers[question["id"]],
            "correct_index": question["answer_index"],
            "correct_answer": question["options"][question["answer_index"]],
            "is_correct": submission.answers[question["id"]] == question["answer_index"],
            "explanation": question["explanation"],
        }
        for question in bank
    ]

    correct = sum(item["is_correct"] for item in review)
    return {
        "category_id": submission.category_id,
        "correct": correct,
        "total": len(bank),
        "score_percent": round(100 * correct / len(bank)),
        "review": review,
        "disclaimer": "Practice assessment only: this score is not a validated measure of aptitude or career suitability.",
    }
