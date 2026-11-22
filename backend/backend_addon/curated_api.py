"""Drop-in FastAPI router. Keeps the existing /api/careers endpoint unchanged."""
from fastapi import APIRouter, Query, HTTPException
from .curated_recommender import recommend, skill_catalog, get_career

router = APIRouter(tags=['Curated SkillShadow Recommendations'])

@router.get('/api/careers-curated')
def careers_curated(
    skills: str = '',
    interests: str = '',
    education: str = '',
    proficiency: str = '',
    q: str = '',
    limit: int = Query(24, ge=1, le=100),
):
    return recommend(skills, interests, education, proficiency, limit, q)

@router.get('/api/skills-curated')
def skills_curated(q: str = '', limit: int = Query(50, ge=1, le=200)):
    return [s for s in skill_catalog() if q.casefold() in s.casefold()][:limit]


@router.get("/api/careers-curated/{code}")
def career_curated_detail(code: str):
    role = get_career(code)
    if role is None:
        raise HTTPException(status_code=404, detail="Curated career not found")
    return role
