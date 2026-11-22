import os, re, hmac, hashlib, secrets, math, json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional
import jwt
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, select
from sqlalchemy.orm import declarative_base, sessionmaker, Session

BASE=Path(__file__).parent
load_dotenv(BASE/'.env')
SECRET=os.getenv('SECRET_KEY','')
if len(SECRET)<32:
    raise RuntimeError('Set SECRET_KEY (at least 32 characters) in backend/.env')
URL=os.getenv('DATABASE_URL','sqlite:///./skillshadow.db')
engine=create_engine(URL,connect_args={'check_same_thread':False} if URL.startswith('sqlite') else {},pool_pre_ping=True)
SessionLocal=sessionmaker(bind=engine)
Base=declarative_base()
class User(Base):
    __tablename__='users'
    id=Column(Integer,primary_key=True)
    email=Column(String(255),unique=True,nullable=False,index=True)
    name=Column(String(120),nullable=False)
    password_hash=Column(String(250),nullable=False)
    created_at=Column(DateTime,default=datetime.utcnow)
class Profile(Base):
    __tablename__='profiles'
    id=Column(Integer,primary_key=True)
    user_id=Column(Integer,ForeignKey('users.id'),unique=True,nullable=False)
    skills=Column(Text,default='[]')
    interests=Column(Text,default='')
    education=Column(String(150),default='')
class SavedCareer(Base):
    __tablename__='saved_careers'
    id=Column(Integer,primary_key=True)
    user_id=Column(Integer,ForeignKey('users.id'),nullable=False)
    occupation_code=Column(String(30),nullable=False)
    created_at=Column(DateTime,default=datetime.utcnow)
Base.metadata.create_all(engine)

def db():
    s=SessionLocal()
    try: yield s
    finally: s.close()

def hash_password(password):
    salt=secrets.token_bytes(16)
    digest=hashlib.scrypt(password.encode(),salt=salt,n=2**14,r=8,p=1)
    return salt.hex()+':'+digest.hex()
def verify_password(password,stored):
    try:
        salt,expected=stored.split(':')
        actual=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**14,r=8,p=1)
        return hmac.compare_digest(actual,bytes.fromhex(expected))
    except (ValueError,TypeError): return False

def token(user):
    return jwt.encode({'sub':str(user.id),'exp':datetime.now(timezone.utc)+timedelta(days=7)},SECRET,algorithm='HS256')
security=HTTPBearer(auto_error=False)
def current_user(credentials:Optional[HTTPAuthorizationCredentials]=Depends(security),s:Session=Depends(db)):
    if not credentials: raise HTTPException(401,'Sign in required')
    try: user_id=int(jwt.decode(credentials.credentials,SECRET,algorithms=['HS256'])['sub'])
    except (jwt.PyJWTError,ValueError,KeyError): raise HTTPException(401,'Invalid or expired session')
    user=s.get(User,user_id)
    if not user: raise HTTPException(401,'User not found')
    return user

class AuthInput(BaseModel):
    email:EmailStr
    password:str=Field(min_length=8,max_length=128)
class RegisterInput(AuthInput):
    name:str=Field(min_length=2,max_length=120)
class ProfileInput(BaseModel):
    skills:list[str]=Field(default_factory=list,max_length=40)
    interests:str=Field(default='',max_length=500)
    education:str=Field(default='',max_length=150)
class CareerSave(BaseModel):
    occupation_code:str

app=FastAPI(title='SkillShadow API',version='1.0.0')
from backend_addon.curated_api import router as curated_router
app.include_router(curated_router)
origins=[x.strip() for x in os.getenv('CORS_ORIGINS','http://localhost:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Authorization','Content-Type'])

# O*NET occupation profiles. Keep the original jobs.csv separately for job listings.
# Only normalize true spelling/abbreviation variants. Database products such as
# PostgreSQL/MySQL are NOT equivalent to knowing the SQL language.
SKILL_ALIASES = {
    'py': 'python', 'python 3': 'python', 'js': 'javascript',
    'springboot': 'spring boot', 'spring boot framework': 'spring boot',
    'ms excel': 'microsoft excel', 'excel': 'microsoft excel',
    'powerbi': 'microsoft power bi', 'power bi': 'microsoft power bi',
}

def normalize_skill(value):
    value = re.sub(r'[^a-z0-9+#. ]+', ' ', str(value).casefold()).strip()
    value = re.sub(r'\s+', ' ', value)
    return SKILL_ALIASES.get(value, value)

@lru_cache(maxsize=1)
def occupation_data():
    path = BASE / 'data' / 'career_profiles.jsonl'
    if not path.is_file():
        raise HTTPException(503, 'Missing backend/data/career_profiles.jsonl; copy it from the cleaned O*NET package')
    mapping, catalog = {}, set()
    with path.open(encoding='utf-8') as file:
        for line in file:
            if not line.strip():
                continue
            p = json.loads(line)
            code = str(p['occupation_code'])
            software = p.get('software') or {}
            core = p.get('essential_skills') or {}
            knowledge = p.get('knowledge') or {}
            tasks = p.get('tasks') or []
            technical = list(software)
            core_names = list(core)
            catalog.update(technical + core_names)
            mapping[code] = {
                'code': code, 'title': p.get('career_title', ''),
                'description': p.get('description', ''),
                'technical': technical, 'core': core_names,
                'software': software, 'essential_skills': core,
                'knowledge': knowledge, 'tasks': tasks,
                'job_zone': p.get('job_zone'),
                'alternate_titles': p.get('alternate_titles') or [],
                'all': {normalize_skill(x) for x in technical + core_names},
            }
    return mapping, sorted(catalog, key=str.casefold)

# Transparent, non-ML career-ranking heuristic.  It does not predict employment.
# Career interests are provided by students, or cautiously inferred from distinctive
# combinations of tools.  Career titles are given more weight than incidental
# software overlaps and passing mentions in occupational descriptions.
DOMAIN_TERMS = {
    # Keep a specific Data Science interest separate from database operations.
    # These are occupational-title hints, not proof of role eligibility.
    'data_science': ('data scientist', 'data scientists', 'data science',
                     'machine learning', 'statistician', 'statisticians',
                     'data analyst', 'data analysts', 'data engineer',
                     'analytics'),
    'data': ('data', 'statistic', 'analytics', 'analyst', 'business intelligence',
             'database', 'machine learning', 'data mining', 'quantitative'),
    'software': ('software', 'developer', 'programmer', 'web', 'application',
                 'computer systems', 'information technology'),
    'security': ('cyber', 'security', 'information assurance'),
    'health': ('health', 'medical', 'clinical', 'nurs', 'patient'),
    'finance': ('financial', 'account', 'audit', 'investment', 'econom'),
    'design': ('design', 'graphic', 'artist', 'visual', 'animation'),
    'education': ('teach', 'education', 'instructor', 'professor'),
    'marketing': ('marketing', 'advertis', 'sales', 'market research'),
}

# These are *hints*, not evidence of a student's true career preferences.
# Require multiple distinctive tools to infer a domain.  In particular,
# Python alone never implies a data-science interest.
DOMAIN_HINTS = {
    'data': {'pandas', 'numpy', 'matplotlib', 'seaborn', 'scikit learn',
             'scikit-learn', 'tableau', 'microsoft power bi', 'jupyter',
             'r', 'sql', 'python', 'statistics', 'machine learning'},
    'software': {'javascript', 'typescript', 'react', 'react js', 'node.js',
                 'nodejs', 'html', 'css', 'java', 'git', 'c++', 'c#',
                 'spring boot', 'spring framework', 'django', 'fastapi', 'flask'},
    'security': {'cybersecurity', 'penetration testing', 'network security', 'wireshark'},
    'design': {'figma', 'adobe illustrator', 'adobe photoshop', 'adobe xd'},
}
DOMAIN_ANCHORS = {
    'data': {'pandas', 'numpy', 'matplotlib', 'seaborn', 'scikit learn',
             'scikit-learn', 'tableau', 'microsoft power bi', 'jupyter'},
    'software': {'javascript', 'typescript', 'react', 'react js', 'node.js',
                 'nodejs', 'html', 'css', 'spring boot', 'spring framework',
                 'django', 'fastapi', 'flask'},
    'security': {'cybersecurity', 'penetration testing', 'network security'},
    'design': {'figma', 'adobe illustrator', 'adobe photoshop', 'adobe xd'},
}


def infer_domains(selected):
    """Conservative guess used ONLY if no explicit interests were supplied."""
    found = []
    for domain, hints in DOMAIN_HINTS.items():
        hits = selected & hints
        if len(hits) >= 2 and (hits & DOMAIN_ANCHORS[domain]):
            found.append(domain)
    return found


def explicit_domains(interest):
    text = str(interest or '').casefold().strip()
    if not text:
        return []
    # Whole terms/phrases only; avoids 'data' matching words such as 'metadata'.
    found = [domain for domain, terms in DOMAIN_TERMS.items()
             if re.search(r'(?<![a-z])' + re.escape(domain.replace('_', ' ')) + r'(?![a-z])', text)
             or any(re.search(r'(?<![a-z])' + re.escape(term) + r'(?![a-z])', text)
                    for term in terms)]
    # 'data science' contains the word 'data', but is more specific.
    if 'data_science' in found and 'data' in found:
        found.remove('data')
    return found


def role_domain_fit(occupation, domains):
    """A 0..1 domain-evidence indicator; zero means no evidence, not unqualified."""
    if not domains:
        return None
    title = str(occupation.get('title') or '').casefold()
    alt_titles = ' '.join(str(x) for x in occupation.get('alternate_titles') or []).casefold()
    desc = str(occupation.get('description') or '').casefold()
    best = 0.0
    for domain in domains:
        for term in DOMAIN_TERMS.get(domain, ()):
            pattern = r'(?<![a-z])' + re.escape(term) + r'(?![a-z])'
            if re.search(pattern, title):
                best = max(best, 1.0)
            elif re.search(pattern, alt_titles):
                best = max(best, 0.9)
            elif re.search(pattern, desc):
                best = max(best, 0.25)
    return best


def interest_relevance(interest, occupation):
    """Use explicit interest when available; do not invent a positive signal."""
    text = str(interest or '').strip().casefold()
    if not text:
        return None
    domains = explicit_domains(text)
    if domains:
        return role_domain_fit(occupation, domains)
    title = str(occupation.get('title') or '').casefold()
    desc = str(occupation.get('description') or '').casefold()
    words = [x for x in re.findall(r'[a-z]{3,}', text)
             if x not in {'career', 'interested', 'field', 'work', 'jobs'}]
    if not words:
        return None
    return max((1.0 if w in title else 0.20 if w in desc else 0.0)
               for w in words)


def education_fit(education, zone):
    if not education or zone is None or str(zone).strip() == '':
        return None
    edu = str(education).casefold()
    # Job Zone is preparation needed, NOT a formal education requirement.
    # Educational compatibility is only a small exploratory signal.
    level = (5 if any(x in edu for x in ('master', 'phd', 'doctorate'))
             else 4 if any(x in edu for x in ('bachelor', 'b.tech', 'btech',
                                              'undergrad', 'degree'))
             else 2 if any(x in edu for x in ('high school', 'secondary', 'diploma'))
             else None)
    if level is None:
        return None
    try:
        return max(0.0, 1.0 - max(0, int(float(zone)) - level) * 0.35)
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=1)
def skill_document_frequencies():
    """Count occupations containing each named skill (IDF-style specificity)."""
    occ, _ = occupation_data()
    n = max(1, len(occ))
    frequency = defaultdict(int)
    for o in occ.values():
        all_skills = set(o.get('all') or ())
        all_skills.update(normalize_skill(x) for x in o.get('knowledge', {}))
        for skill in all_skills:
            frequency[skill] += 1
    return n, dict(frequency)


def skill_specificity(skill, total, frequency):
    """A modest 1..2 multiplier so common tools count but do not dominate."""
    return 1.0 + min(1.0, math.log((total + 1) / (frequency.get(skill, 0) + 1)) /
                     max(1.0, math.log(total + 1)))


def career_rank(occupation, selected, interests='', education='',
                corpus_stats=None):
    software = {normalize_skill(k): v for k, v in occupation['software'].items()}
    core = {normalize_skill(k): v for k, v in occupation['essential_skills'].items()}
    knowledge = {normalize_skill(k): v for k, v in occupation['knowledge'].items()}
    universe = set(software) | set(core) | set(knowledge)
    matched = sorted(selected & universe)
    if selected and not matched:
        return None
    if not selected and not str(interests or '').strip():
        return None  # Avoid arbitrary recommendations before a student provides context.

    # The displayed *coverage* is an actual fraction of user-selected named
    # skills. The composite match_score is a separate heuristic relevance score.
    coverage = len(matched) / len(selected) if selected else 0.0
    if corpus_stats is None:
        corpus_stats = skill_document_frequencies()
    total, frequency = corpus_stats
    selected_weight = sum(skill_specificity(s, total, frequency) for s in selected)
    # Named O*NET software examples are stronger technology evidence than
    # matching a broad knowledge-area label. Neither means job-ready.
    def evidence_strength(skill):
        if skill in software:
            return 1.0
        if skill in core:
            return 0.8
        if skill in knowledge:
            return 0.35
        return 0.0

    evidence_weight = sum(skill_specificity(s, total, frequency) * evidence_strength(s)
                          for s in matched)
    weighted_coverage = evidence_weight / selected_weight if selected_weight else 0.0
    skill_score = 0.35 * coverage + 0.65 * weighted_coverage

    explicit_interest = bool(str(interests or '').strip())
    domain = explicit_domains(interests) if explicit_interest else infer_domains(selected)
    domain_fit = role_domain_fit(occupation, domain)
    # With a clear data/software/etc. interest, don't elevate off-topic roles
    # solely because they incidentally list a common tool. Strong (>=75%)
    # multi-skill overlaps remain eligible as adjacent career exploration.
    if domain and domain_fit is not None and domain_fit < 0.5 and coverage < 0.75:
        return None
    interest = interest_relevance(interests, occupation) if explicit_interest else domain_fit
    edu = education_fit(education, occupation.get('job_zone'))

    parts = []
    if selected:
        parts.append((skill_score, 0.55 if not explicit_interest else 0.50))
    if interest is not None:
        parts.append((interest, 0.40 if explicit_interest else 0.35))
    if edu is not None:
        parts.append((edu, 0.10))
    if not parts:
        return None
    score = 100.0 * sum(value * weight for value, weight in parts) / sum(weight for _, weight in parts)
    # Any result must have skill overlap, unless the user expressly supplied
    # an interest-only search. This prevents zero-evidence role suggestions.
    if not selected and (interest is None or interest <= 0):
        return None

    gap_candidates = []
    for skill, info in software.items():
        if skill not in selected:
            in_demand = info.get('in_demand') if isinstance(info, dict) else False
            in_demand = in_demand is True or str(in_demand).strip().casefold() in {'1', 'true', 'yes', 'y'}
            gap_candidates.append((2 if in_demand else 1, skill))
    for skill, info in core.items():
        if skill not in selected:
            importance = info.get('importance') if isinstance(info, dict) else None
            try:
                strength = 1.0 + max(0.0, min(1.0, (float(importance) - 1.0) / 4.0))
            except (TypeError, ValueError):
                strength = 1.0
            gap_candidates.append((strength, skill))
    gap_candidates.sort(key=lambda pair: (-pair[0], pair[1]))
    missing = list(dict.fromkeys(skill for _, skill in gap_candidates))[:10]
    return {
        'code': occupation['code'], 'title': occupation['title'],
        'match_score': round(min(100.0, max(0.0, score))),
        'skill_coverage': round(100.0 * coverage),
        'matched_skills': matched, 'missing_skills': missing,
        'matched_software_skills': sorted(selected & set(software)),
        'matched_core_skills': sorted(selected & set(core)),
        'matched_knowledge_areas': sorted(selected & set(knowledge)),
        'skill_coverage_explanation': 'Share of student-entered skills found in this occupation profile; not percent of job requirements met.',
        'skill_gap_explanation': 'Skills to explore from O*NET examples and essential-skill data; not a verified list of employer requirements.',
        'technical_count': len(software), 'core_count': len(core),
        'interest_score': None if interest is None else round(100.0 * interest),
        'job_zone': occupation.get('job_zone'),
        'ranking_method': 'explainable-heuristic-v3',
        'inferred_domains': domain if not explicit_interest else [],
        'matched_interest_domains': domain if explicit_interest else [],
        'score_disclaimer': 'Relative exploration score, not likelihood of hiring or eligibility.',
    }

@lru_cache(maxsize=1)
def job_data():
    df=pd.read_csv(BASE/'data/jobs.csv',usecols=['job_id','title','company_name','location','formatted_work_type','annual_salary_usd_for_comparison','job_posting_url'],low_memory=False)
    return df.fillna({'title':'','company_name':'','location':'','formatted_work_type':'','job_posting_url':''})

@app.get('/api/health')
def health(): return {'status':'ok'}
@app.post('/api/auth/register',status_code=201)
def register(payload:RegisterInput,s:Session=Depends(db)):
    email=str(payload.email).lower()
    if s.scalar(select(User).where(User.email==email)): raise HTTPException(409,'Email already registered')
    u=User(name=payload.name.strip(),email=email,password_hash=hash_password(payload.password));s.add(u);s.flush()
    s.add(Profile(user_id=u.id,skills='[]'));s.commit();s.refresh(u)
    return {'token':token(u),'user':{'name':u.name,'email':u.email}}
@app.post('/api/auth/login')
def login(payload:AuthInput,s:Session=Depends(db)):
    u=s.scalar(select(User).where(User.email==str(payload.email).lower()))
    if not u or not verify_password(payload.password,u.password_hash): raise HTTPException(401,'Incorrect credentials')
    return {'token':token(u),'user':{'name':u.name,'email':u.email}}
@app.get('/api/me')
def me(u:User=Depends(current_user)):
    return {'name':u.name,'email':u.email}
@app.get('/api/profile')
def get_profile(u:User=Depends(current_user),s:Session=Depends(db)):
    import json
    p=s.scalar(select(Profile).where(Profile.user_id==u.id))
    return {'skills':json.loads(p.skills or '[]'),'interests':p.interests or '','education':p.education or ''}
@app.put('/api/profile')
def put_profile(payload:ProfileInput,u:User=Depends(current_user),s:Session=Depends(db)):
    import json
    p=s.scalar(select(Profile).where(Profile.user_id==u.id))
    p.skills=json.dumps(list(dict.fromkeys(x.strip() for x in payload.skills if x.strip())));p.interests=payload.interests;p.education=payload.education
    s.commit();return {'ok':True}
@app.get('/api/skills')
def skills(q:str='',limit:int=30):
    _,catalog=occupation_data()
    limit=min(max(limit,1),100)
    return [x for x in catalog if q.casefold() in x.casefold()][:limit]
@app.get('/api/overview')
def overview():
    occ,_=occupation_data();jobs=job_data()
    return {'occupations':len(occ),'skills':len(occupation_data()[1]),'historical_jobs':len(jobs),'companies':int(jobs.company_name.nunique())}
@app.get('/api/careers')
def careers(skills:str='',q:str='',limit:int=24,interests:str='',education:str=''):
    occ,_=occupation_data()
    selected={normalize_skill(x) for x in skills.split(',') if x.strip()}
    limit=min(max(limit,1),100)
    results=[]
    for o in occ.values():
        if q and q.casefold() not in o['title'].casefold():
            continue
        item=career_rank(o,selected,interests,education)
        if item is not None:
            results.append(item)
    results.sort(key=lambda x:(-x['match_score'],-x['skill_coverage'],x['title']))
    return results[:limit]
@app.get('/api/careers/{code}')
def career_detail(code:str):
    o=occupation_data()[0].get(code)
    if not o:raise HTTPException(404,'Occupation not found')
    return {k:v for k,v in o.items() if k!='all'}
@app.get('/api/jobs')
def jobs(q:str='',location:str='',limit:int=30):
    df=job_data()
    if q:df=df[df.title.str.contains(re.escape(q),case=False,na=False)]
    if location:df=df[df.location.str.contains(re.escape(location),case=False,na=False)]
    count=len(df);df=df.head(min(max(limit,1),100)).copy()
    df=df.replace({float('nan'):None})
    records=[]
    for row in df.to_dict('records'):
        salary=row['annual_salary_usd_for_comparison']
        if not isinstance(salary,(int,float)) or not math.isfinite(salary):row['annual_salary_usd_for_comparison']=None
        records.append(row)
    return {'total':count,'items':records}
@app.get('/api/saved')
def saved(u:User=Depends(current_user),s:Session=Depends(db)):
    occ=occupation_data()[0]
    return [{'code':x.occupation_code,'title':occ.get(x.occupation_code,{}).get('title',x.occupation_code)} for x in s.scalars(select(SavedCareer).where(SavedCareer.user_id==u.id)).all()]
@app.post('/api/saved',status_code=201)
def save_career(payload:CareerSave,u:User=Depends(current_user),s:Session=Depends(db)):
    if payload.occupation_code not in occupation_data()[0]:raise HTTPException(404,'Unknown occupation')
    exists=s.scalar(select(SavedCareer).where(SavedCareer.user_id==u.id,SavedCareer.occupation_code==payload.occupation_code))
    if not exists:s.add(SavedCareer(user_id=u.id,occupation_code=payload.occupation_code));s.commit()
    return {'ok':True}
@app.delete('/api/saved/{code}')
def remove_career(code:str,u:User=Depends(current_user),s:Session=Depends(db)):
    x=s.scalar(select(SavedCareer).where(SavedCareer.user_id==u.id,SavedCareer.occupation_code==code))
    if x:s.delete(x);s.commit()
    return {'ok':True}

from roadmap_module.router import install as install_roadmap

install_roadmap(
    app=app,
    Base=Base,
    engine=engine,
    db=db,
    current_user=current_user,
    Profile=Profile,
    occupation_data=occupation_data,
    normalize_skill=normalize_skill
)
