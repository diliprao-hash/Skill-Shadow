import os, re, hmac, hashlib, secrets, math
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
origins=[x.strip() for x in os.getenv('CORS_ORIGINS','http://localhost:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Authorization','Content-Type'])

@lru_cache(maxsize=1)
def occupation_data():
    df=pd.read_csv(BASE/'data/occupations.csv',usecols=['occupation_code','occupation_title','skill_name','skill_type','importance_score'],low_memory=False)
    df=df.dropna(subset=['occupation_code','occupation_title','skill_name']).drop_duplicates(['occupation_code','skill_name','skill_type'])
    mapping={};catalog=set()
    for (code,title),g in df.groupby(['occupation_code','occupation_title']):
        tech=g[g.skill_type.eq('software')].skill_name.astype(str).tolist()
        core=g[~g.skill_type.eq('software')].skill_name.astype(str).tolist()
        mapping[str(code)]={'code':str(code),'title':str(title),'technical':tech,'core':core,'all':set(x.casefold() for x in tech+core)}
        catalog.update(tech+core)
    return mapping,sorted(catalog,key=str.casefold)

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
def careers(skills:str='',q:str='',limit:int=24):
    occ,_=occupation_data();selected=set(x.strip().casefold() for x in skills.split(',') if x.strip())
    limit=min(max(limit,1),100)
    results=[]
    for o in occ.values():
        if q and q.casefold() not in o['title'].casefold():continue
        matched=selected&o['all']
        if selected and not matched:continue
        score=round(100*len(matched)/len(selected)) if selected else 0
        results.append({'code':o['code'],'title':o['title'],'match_score':score,'matched_skills':sorted(matched),'technical_count':len(o['technical']),'core_count':len(o['core'])})
    results.sort(key=lambda x:(-x['match_score'],-len(x['matched_skills']),x['title']))
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
