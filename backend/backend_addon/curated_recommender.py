"""Explainable role-specific recommender. No model training, hiring prediction or guaranteed accuracy.

Input data: backend/data/curated_careers.json and backend/data/skill_aliases.csv
Generated from user's O*NET-derived career profiles + transparently editorial role-skill curation.
"""
from __future__ import annotations
import csv
import json
import re
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'

# Explicit interests matter more than inferred interests. Unknown phrases are not guessed.
# For highly specialized pathways, require at least one defining skill.
# This prevents generic Git/Python/API overlaps from suggesting unrelated careers.
ROLE_ANCHORS = {
    '19-1029.01': {'bioinformatics','genomics'},
    '17-2199.08': {'robotics','ros','control systems'},
    '15-2031.00': {'optimization','linear programming','simulation'},
    '15-1299.07': {'blockchain','solidity','smart contracts'},
    'SS-JAVA-DEVELOPER': {'java','spring boot'},
    'SS-PYTHON-DEVELOPER': {'python','fastapi','django','flask'},
    'SS-MOBILE': {'mobile development','kotlin','android','flutter','dart','react native'},
    'SS-NLP-ENGINEER': {'nlp','text preprocessing','transformers','hugging face'},
    'SS-CV-ENGINEER': {'computer vision','opencv','image processing'},
    'SS-DEVOPS': {'docker','kubernetes','ci/cd','terraform'},
    'SS-CLOUD': {'aws','azure','cloud computing','terraform'},
    'SS-CLOUD-ARCH': {'cloud architecture','cloud computing','aws','azure'},
    'SS-ML-ENGINEER': {'machine learning','model deployment','mlops','scikit-learn','pytorch','tensorflow'},
    '15-1299.04': {'penetration testing','burp suite','vulnerability assessment','nmap'},
    '15-1299.06': {'digital forensics','computer forensics','evidence handling','malware analysis'},
    'SS-UIUX': {'figma','ui design','ux research','wireframing','prototyping'},
    'SS-PRODUCT-ANALYST': {'product analytics','experimentation','cohort analysis'},
    'SS-SUPPLY-CHAIN': {'supply chain','inventory management','forecasting'},
    'SS-DATA-ENGINEER': {'etl','data pipelines','apache airflow','apache spark','data modeling'},
    'SS-QA-AUTO': {'selenium','pytest','automated testing','playwright'},
    'SS-BACKEND': {'api development','backend development','spring boot','fastapi','django'},
    'SS-FRONTEND': {'html','css','react','frontend development','responsive design'},
    'SS-FULLSTACK': {'node.js','react','api development','javascript'},
    'SS-DATA-VIZ': {'data visualization','dashboard design','tableau','power bi','plotly'},
    'SS-BUSINESS-ANALYST': {'business analysis','requirements gathering','process modeling'},
}

INTEREST_DOMAINS = [
    ('data science', ('data_science',)),
    ('machine learning', ('data_science',)),
    ('artificial intelligence', ('data_science', 'research')),
    ('data engineering', ('data_engineering',)),
    ('data analyst', ('analytics',)),
    ('business intelligence', ('analytics',)),
    ('business analytics', ('analytics', 'business')),
    ('data analytics', ('analytics',)),
    ('data', ('data_science', 'analytics', 'data_engineering')),
    ('software development', ('software',)),
    ('web development', ('web',)),
    ('frontend', ('web',)),
    ('backend', ('software',)),
    ('full stack', ('web', 'software')),
    ('mobile', ('mobile',)),
    ('software testing', ('qa',)),
    ('quality assurance', ('qa',)),
    ('devops', ('cloud',)),
    ('cloud computing', ('cloud',)),
    ('cybersecurity', ('security',)),
    ('cyber security', ('security',)),
    ('security', ('security',)),
    ('networking', ('network',)),
    ('network', ('network',)),
    ('ui ux', ('design',)),
    ('user experience', ('design',)),
    ('graphic design', ('design',)),
    ('design', ('design',)),
    ('marketing', ('marketing',)),
    ('finance', ('finance',)),
    ('accounting', ('finance',)),
    ('business', ('business',)),
    ('operations', ('operations',)),
    ('supply chain', ('operations',)),
    ('robotics', ('robotics',)),
    ('bioinformatics', ('bioinformatics',)),
    ('blockchain', ('blockchain',)),
    ('research', ('research',)),
    ('management', ('management',)),
]

@lru_cache(maxsize=1)
def load_data():
    with (DATA/'curated_careers.json').open(encoding='utf-8') as f:
        roles = json.load(f)
    with (DATA/'skill_aliases.csv').open(encoding='utf-8-sig',newline='') as f:
        aliases = {row['input_variant']:row['canonical_skill'] for row in csv.DictReader(f)}
    return roles, aliases

def normalize_skill(value):
    text = re.sub(r'[^a-z0-9+#./ -]', '', str(value or '').casefold()).strip()
    text = re.sub(r'\s+', ' ', text)
    return load_data()[1].get(text, text)

def parse_skills(skills):
    if isinstance(skills, str):
        parts = skills.split(',')
    else:
        parts = skills or []
    return list(dict.fromkeys(normalize_skill(x) for x in parts if str(x).strip()))

def interest_domains(interest):
    text = re.sub(r'[^a-z0-9 ]',' ',str(interest or '').casefold())
    text = re.sub(r'\s+',' ',text).strip()
    if not text:
        return []
    # Longest/specific phrases take precedence over the broad word 'data'.
    for phrase, domains in INTEREST_DOMAINS:
        if re.search(r'(?<![a-z])'+re.escape(phrase)+r'(?![a-z])',text):
            return list(domains)
    return []

def proficiency_level(value):
    if value is None or str(value).strip() == '':
        return None
    text = str(value).casefold().strip()
    return {'beginner':1,'basic':1,'intermediate':2,'advanced':3,'expert':3,'1':1,'2':2,'3':3}.get(text)

def education_compatibility(education, zone):
    """A tiny preparation proxy; O*NET Job Zone is NOT a degree requirement."""
    text = str(education or '').casefold()
    if not text:
        return None
    level = (5 if any(t in text for t in ('master','phd','doctorate')) else
             4 if any(t in text for t in ('bachelor','b.tech','btech','undergrad','degree')) else
             2 if any(t in text for t in ('diploma','intermediate','high school','secondary')) else None)
    if level is None or zone is None:
        return None
    try:
        return max(0.0,1.0-0.30*max(0,float(zone)-level))
    except (TypeError,ValueError):
        return None

def recommend(skills='', interests='', education='', proficiency=None, limit=24, q=''):
    selected = parse_skills(skills)
    selected_set = set(selected)
    desired_domains = interest_domains(interests)
    prof = proficiency_level(proficiency)
    if not selected and not desired_domains:
        return []
    results=[]
    for role in load_data()[0]:
        if q and q.casefold() not in role['title'].casefold():
            continue
        core=[x for x in role['skills'] if x['priority']=='core']
        weights={x['skill']:x for x in role['skills']}
        matched=[weights[s] for s in selected if s in weights]
        matched_core=[x for x in matched if x['priority']=='core']
        if selected and not matched:
            continue
        anchors=ROLE_ANCHORS.get(role['role_id'])
        if selected and anchors and not (selected_set & anchors):
            continue
        if selected and not matched_core and len(matched)<2:
            continue  # One incidental optional technology isn't a good recommendation.
        role_domains=role['domains']
        domain_fit=(1.0 if desired_domains and role_domains[0] in desired_domains else
                    0.7 if desired_domains and set(role_domains)&set(desired_domains) else 0.0)
        # Interest filtering is conservative; very strong skill matches can remain.
        raw_core=sum(x['weight'] for x in matched_core)/max(1,sum(x['weight'] for x in core))
        if desired_domains and domain_fit==0 and raw_core<0.65:
            continue
        if not selected and domain_fit==0:
            continue
        def mastery(x):
            return 1.0 if prof is None else min(1.0,prof / max(1,x['target_proficiency']))
        total_weight=sum(x['weight'] for x in role['skills'])
        requirement_coverage=sum(x['weight']*mastery(x) for x in matched)/max(1,total_weight)
        core_coverage=sum(x['weight']*mastery(x) for x in matched_core)/max(1,sum(x['weight'] for x in core))
        input_precision=sum((1.0 if x['priority']=='core' else 0.6)*mastery(x) for x in matched)/max(1,len(selected))
        skill_score=0.55*requirement_coverage+0.30*core_coverage+0.15*input_precision
        # Interest helps order similar skill matches, but cannot manufacture skills.
        interest_bonus=(0.13*domain_fit if selected else 0.30*domain_fit)
        education_fit=education_compatibility(education,role.get('job_zone'))
        edu_bonus=0.02*education_fit if education_fit is not None else 0.0
        score=100*min(1.0,0.85*skill_score+interest_bonus+edu_bonus)
        missing=sorted((x for x in role['skills'] if x['skill'] not in selected_set),
                       key=lambda x:(x['priority']!='core',-x['weight'],x['skill']))
        gaps=[{'skill':x['skill'],'priority':x['priority'],'editorial_weight':x['weight'],
               'onet_alignment':x['onet_alignment']} for x in missing[:8]]
        matched_names=[x['skill'] for x in matched]
        results.append({
            'code':role['code'],'title':role['title'],
            'occupation_code':role['occupation_code'],
            'match_score':round(score),
            'skill_coverage':round(100*len(matched)/max(1,len(selected))),
            'required_skill_coverage':round(100*requirement_coverage),
            'core_skill_coverage':round(100*core_coverage),
            'matched_skills':matched_names,
            'matched_software_skills':matched_names,
            'matched_core_skills':[x['skill'] for x in matched_core],
            'matched_knowledge_areas':[],
            'missing_skills':[x['skill'] for x in missing[:8]],
            'skill_gaps':gaps,
            'job_zone':role.get('job_zone'),
            'interest_score':round(domain_fit*100) if desired_domains else None,
            'ranking_method':'curated-skill-matrix-v1',
            'score_disclaimer':'Heuristic career relevance, NOT model accuracy, hiring probability or formal eligibility.',
            'skill_coverage_explanation':'Share of the student-entered skills present in the curated role profile.',
            'skill_gap_explanation':'Editorial learning priorities, not mandatory employer requirements.',
            'technical_count':len(role['skills']),
            'core_count':len(core),
            'inferred_domains':[],
            'matched_interest_domains':desired_domains if domain_fit else [],
            'onet_source_url':role['source_url'],
            'custom_pathway':role['is_custom_pathway'],
            'matched_proficiency':prof,
        })
    results.sort(key=lambda x:(-x['match_score'],-x['core_skill_coverage'],-len(x['matched_core_skills']),x['title']))
    return results[:min(100,max(1,int(limit)))]

def skill_catalog():
    return sorted({s['skill'] for r in load_data()[0] for s in r['skills']})


def get_career(role_id):
    """Return curated role, with source attribution and skills."""
    for role in load_data()[0]:
        if role["role_id"] == role_id:
            return role
    return None
