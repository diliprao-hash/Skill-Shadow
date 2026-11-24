"""Read-only analytics API. Use app.include_router(router) in backend/main.py."""
from fastapi import APIRouter, HTTPException, Query
from . import service

router = APIRouter(prefix='/api/onet-analytics', tags=['SkillShadow O*NET Analytics'])

@router.get('/overview')
def overview():
    return service.overview()

@router.get('/skills')
def top_skills(skill_type: str = Query('', description='software_skill, essential_skill, transferable_skill'),
               q: str = '', limit: int = Query(20, ge=1, le=100)):
    if skill_type and skill_type not in service.VALID_TYPES:
        raise HTTPException(status_code=422,detail=f'Choose a skill_type from {service.VALID_TYPES}')
    return service.top_skills(skill_type,q,limit)

@router.get('/software-highlights')
def software_highlights(flag: str=Query('hot', pattern='^(hot|in_demand)$'),
                        limit: int=Query(20,ge=1,le=100)):
    return service.software_highlights(flag,limit)

@router.get('/occupations')
def search_occupations(q: str='', limit: int=Query(20,ge=1,le=100),
                        offset: int=Query(0,ge=0,le=10000)):
    return service.occupation_search(q,limit,offset)

@router.get('/occupations/{code}')
def occupation_detail(code: str, max_skills: int=Query(15,ge=1,le=100)):
    result = service.occupation_profile(code,max_skills)
    if result is None:
        raise HTTPException(404, 'Occupation not found in O*NET catalog')
    return result

@router.get('/interest-summary')
def interest_summary():
    return service.interest_summary()

@router.get('/career-match-preview')
def match_preview(skills: str=Query(''), limit: int=Query(10,ge=1,le=30),
                  riasec: str='', interests: str=''):
    return service.career_match_preview(skills,limit,riasec,interests)
