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
