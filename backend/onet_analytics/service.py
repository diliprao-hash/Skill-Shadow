"""Read-only O*NET analytics and an isolated weighted-cosine matching preview.

Occupational skill scores reflect O*NET occupation attributes, NOT student ability.
O*NET skill importance (1..5) and RIASEC interest scores (1..7) stay separate.
No employer job openings, salaries or accuracy guarantees are inferred.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction import DictVectorizer
from sklearn.preprocessing import normalize

DATA_DIR = Path(__file__).resolve().parent.parent / 'data' / 'onet'
VALID_TYPES = ('software_skill', 'essential_skill', 'transferable_skill')
RIASEC = ('Realistic', 'Investigative', 'Artistic', 'Social', 'Enterprising', 'Conventional')
DOMAIN_ROLE_TITLES = {
    'data science': ('data scientist', 'statistician', 'operations research', 'business intelligence', 'computer and information research'),
    'data analytics': ('data scientist', 'statistician', 'business intelligence', 'data', 'operations research'),
    'data': ('data scientist', 'statistician', 'business intelligence', 'data', 'operations research'),
    'web development': ('web developer', 'web and digital interface', 'software developer', 'computer programmer'),
    'frontend': ('web developer', 'web and digital interface', 'software developer'),
    'backend': ('software developer', 'computer programmer', 'web developer'),
    'software development': ('software developer', 'computer programmer', 'web developer'),
    'cybersecurity': ('security', 'cybersecurity', 'information security'),
}

ALIASES = {
    'py': 'python',
    'python3': 'python',
    'python 3': 'python',
    'js': 'javascript',
    'nodejs': 'node.js',
    'ms excel': 'microsoft excel',
    'excel': 'microsoft excel',
    'powerbi': 'microsoft power bi',
    'power bi': 'microsoft power bi',
    'postgres': 'postgresql',
    'structured query language sql': 'sql',
    'structure query language sql': 'sql',
    'hypertext markup language html': 'html',
    'cascading style sheets css': 'css',
    'oracle java': 'java',
    'sun microsystems java': 'java',
}


def normalize_skill(value: str) -> str:
    value = str(value or '').casefold().strip().replace('–', '-').replace('—', '-')
    value = re.sub(r'\s+', ' ', value)
    return ALIASES.get(value, value)


@lru_cache(maxsize=1)
def data():
    """Load three small, versioned, preprocessed CSVs one time per server worker."""
    files = ['occupations.csv', 'skills.csv', 'interests.csv']
    missing = [f for f in files if not (DATA_DIR / f).is_file()]
    if missing:
        raise FileNotFoundError(f'O*NET analytics files missing in {DATA_DIR}: {missing}')
    occ = pd.read_csv(DATA_DIR / 'occupations.csv', dtype={'occupation_code': str}).fillna('')
    skills = pd.read_csv(DATA_DIR / 'skills.csv', dtype={'occupation_code': str})
    interests = pd.read_csv(DATA_DIR / 'interests.csv', dtype={'occupation_code': str})
    skills['normalized_skill'] = skills['skill'].map(normalize_skill)
    skills['importance'] = pd.to_numeric(skills['importance'], errors='coerce')
    interests['score'] = pd.to_numeric(interests['score'], errors='coerce')
    return occ, skills, interests


def overview():
    occ, skills, interests = data()
    coverage = skills.occupation_code.nunique()
    groups = []
    for name in VALID_TYPES:
        group = skills.loc[skills.skill_type.eq(name)]
        groups.append({
            'skill_type': name,
            'records': int(len(group)),
            'occupations': int(group.occupation_code.nunique()),
            'distinct_skill_labels': int(group.normalized_skill.nunique()),
            'importance_missing': int(group.importance.isna().sum()),
            'hot_technology_rows':int(group.hot_technology.eq('Y').sum()),
            'in_demand_flagged_rows':int(group.in_demand.eq('Y').sum()),
        })
    return {
        'source': 'O*NET 31.0 starter dataset (provided by user; derivative)',
        'occupation_count': int(len(occ)),
        'occupations_with_skills': int(coverage),
        'occupations_without_skills': int(len(occ) - coverage),
        'skill_coverage_pct': round(100*coverage/max(1,len(occ)),1),
        'occupation_skill_records': int(len(skills)),
        'occupations_with_riasec': int(interests.occupation_code.nunique()),
        'riasec_records': int(len(interests)),
        'skill_breakdown': groups,
        'notes': ['Software examples have no O*NET importance rating; missing is not zero.',
                  'RIASEC occupational interest scores are on a different scale (1-7).',
                  'Occupation coverage is not recommendation accuracy.'],
    }


def top_skills(skill_type: str, q: str, limit: int):
    _, skills, _ = data()
    selected = skills if not skill_type else skills.loc[skills.skill_type.eq(skill_type)]
    if q:
        selected = selected[selected.normalized_skill.str.contains(q.casefold(), regex=False, na=False)]
    if selected.empty:
        return []
    # One occurrence per occupation and normalized skill, even across software categories.
    counts = (selected.groupby('normalized_skill', as_index=False)
              .agg(occupations=('occupation_code','nunique'),
                   records=('occupation_code','size'),
                   mean_importance=('importance','mean'))
              .sort_values(['occupations','mean_importance','normalized_skill'],ascending=[False,False,True])
              .head(limit))
    return [
        {
            'skill': row['normalized_skill'],
            'occupations_listing_skill': int(row['occupations']),
            'source_records': int(row['records']),
            'mean_importance': None if pd.isna(row['mean_importance']) else round(float(row['mean_importance']),2),
        }
        for row in counts.to_dict('records')
    ]



def software_highlights(flag: str, limit: int):
    """Count O*NET software flags, not live vacancies or current employer demand."""
    _, skills, _ = data()
    source_col = 'hot_technology' if flag == 'hot' else 'in_demand'
    selected = skills[skills.skill_type.eq('software_skill') & skills[source_col].eq('Y')]
    grouped = (selected.groupby('normalized_skill', as_index=False)
               .agg(occupations=('occupation_code','nunique'), records=('occupation_code','size'))
               .sort_values(['occupations','normalized_skill'],ascending=[False,True]).head(limit))
    return {
        'flag': flag,
        'source':'O*NET 31.0 software flags; historical occupational associations',
        'flagged_records':int(len(selected)),
        'items':[{'software':r.normalized_skill, 'occupations_listed':int(r.occupations),
                  'records':int(r.records)} for r in grouped.itertuples(index=False)],
        'warning':'O*NET software flags are not live hiring demand, job postings, salary information, or market growth forecasts.',
    }

def occupation_search(q: str, limit: int, offset: int):
    occ, skills, _ = data()
    if q:
        needle = str(q).casefold()
        occ = occ[occ['title'].str.casefold().str.contains(needle, regex=False) |
                  occ['description'].str.casefold().str.contains(needle, regex=False)]
    counts = skills.groupby('occupation_code').size().rename('skill_records')
    total = len(occ)
    selected = occ.sort_values('title').iloc[offset: offset + limit].join(counts,on='occupation_code')
    return {'total':int(total),'items':[
        {'code':r.occupation_code, 'title':r.title,
         'description':str(r.description)[:220],
         'skill_records': 0 if pd.isna(r.skill_records) else int(r.skill_records)}
        for r in selected.itertuples(index=False)
    ]}


def occupation_profile(code: str, max_skills: int = 15):
    occ, skills, interests = data()
    match = occ.loc[occ.occupation_code.eq(code)]
    if match.empty:
        return None
    row = match.iloc[0]
    group = skills.loc[skills.occupation_code.eq(code)]
    result = {}
    for name in VALID_TYPES:
        subset = group.loc[group.skill_type.eq(name)]
        subset = subset.sort_values(['importance','skill'], ascending=[False,True], na_position='last')
        # Category may repeat; show each named example only once.
        subset = subset.drop_duplicates('normalized_skill')
        result[name] = [{
            'skill':r.skill,
            'category':r.category,
            'importance_1_to_5':None if pd.isna(r.importance) else round(float(r.importance),2),
        } for r in subset.head(max_skills).itertuples(index=False)]
    riasec = interests.loc[interests.occupation_code.eq(code)]
    scores = {str(r.interest_type):round(float(r.score),2) for r in riasec.itertuples(index=False)}
    return {
        'code':code,'title':str(row['title']),'description':str(row['description']),
        'total_skill_records':len(group),
        'skill_counts':{name:int(group.skill_type.eq(name).sum()) for name in VALID_TYPES},
        'skills':result,'riasec_scores_1_to_7':scores,
        'attribution':'Source: O*NET 31.0 (CC BY 4.0); SkillShadow normalized derivative.',
        'note':'Software examples are listed technologies, not verified requirements or employment demand.',
    }


def interest_summary():
    _, _, interests = data()
    rows = interests.groupby('interest_type')['score'].agg(['mean','count']).reindex(RIASEC)
    return [{'interest_type':name,'mean_occupation_score_1_to_7':round(float(rows.loc[name,'mean']),2),
             'occupations':int(rows.loc[name,'count'])} for name in RIASEC]


@lru_cache(maxsize=1)
def model():
    """Sparse content-based skill vectors; weights are exploratory design choices.

    True O*NET importance ratings are used only where available (rated skill groups).
    Software uses a flat binary association weight, not a fabricated importance score.
    IDF limits domination by very common skills and is capped to reduce rare-skill spikes.
    """
    occ, skills, _ = data()
    role_dicts: dict[str, dict[str,float]] = {code:{} for code in occ.occupation_code}
    indexed: dict[str,list[dict]] = {code:[] for code in occ.occupation_code}
    for r in skills.itertuples(index=False):
        key = r.normalized_skill
        if not key: continue
        if r.skill_type == 'software_skill':
            weight = 0.85
        else:
            base = 1.10 if r.skill_type == 'essential_skill' else 1.0
            weight = base * (float(r.importance)/5 if pd.notna(r.importance) else 0.5)
        o = role_dicts[r.occupation_code]
        o[key] = max(o.get(key,0.0),weight)
        indexed[r.occupation_code].append({'skill':r.skill,'normalized_skill':key,
                                            'type':r.skill_type,'weight':round(weight,3)})
    codes = [code for code, val in role_dicts.items() if val]
    vocab = DictVectorizer(sparse=True)
    x = vocab.fit_transform([role_dicts[code] for code in codes]).tocsr()
    n = x.shape[0]
    df = np.asarray(x.getnnz(axis=0)).ravel()
    # modest specificity: IDF 1..2; no zeroes or negative weights
    idf = np.minimum(2.0, 1.0 + np.log((n + 1)/(df + 1))/max(np.log(n + 1),1.0))
    x = x.multiply(idf).tocsr()
    normalize(x, norm='l2', axis=1, copy=False)
    title_lookup = dict(zip(occ.occupation_code, occ.title))
    return codes, vocab, idf, x, indexed, title_lookup


def career_match_preview(skills_csv: str, limit: int, riasec: str='', interests: str=''):
    """An isolated preview; does NOT override SkillShadow /api/careers-curated."""
    selected = list(dict.fromkeys(normalize_skill(s) for s in skills_csv.split(',') if s.strip()))[:40]
    if not selected:
        return {'method':'onet-sparse-weighted-cosine-preview-v1','items':[],
                'note':'Supply one or more student skills.'}
    codes, vocab, idf, x, indexed, titles = model()
    q = vocab.transform([{s:1.0 for s in selected}]).multiply(idf).tocsr()
    if q.nnz == 0:
        return {'method':'onet-sparse-weighted-cosine-preview-v1','items':[],
                'note':'No entered skills matched known normalized O*NET skill labels.'}
    normalize(q,norm='l2',axis=1,copy=False)
    # Require at least two matching skills for a multi-skill profile to avoid
    # recommending unrelated careers solely because they list a generic tool.
    known_selected = [s for s in selected if s in vocab.vocabulary_]
    # Use stricter evidence for longer input lists; generic single-tool
    # overlaps should not crowd out focused matches.
    min_matches = (3 if len(known_selected) >= 4
                   else 2 if len(known_selected) >= 2 else 1)
    # x is sparse normalized occupation vectors; query result is a 1xN sparse matrix.
    similarities = np.asarray((x @ q.T).toarray()).reshape(-1)
    _, _, interest_data = data()
    requested = [k.capitalize() for k in riasec.split(',') if k.strip().capitalize() in RIASEC]
    interest_vals = {}
    if requested:
        chosen = interest_data[interest_data.interest_type.isin(requested)]
        interest_vals = (chosen.groupby('occupation_code')['score'].mean()/7).to_dict()
    # RIASEC is an optional separately declared preference; keep it a small bonus.
    combined = similarities + np.array([0.15*interest_vals.get(code,0.0) if similarities[i]>0 else 0.0
                                        for i,code in enumerate(codes)])
    preference = str(interests or '').casefold().strip()
    # Only explicit student interests can filter occupation domains. Do not
    # infer preferences from an incidental tool such as Python or Excel.
    role_hints = next((terms for key, terms in DOMAIN_ROLE_TITLES.items()
                       if key in preference), None)
    candidates = np.argsort(-combined)
    items=[]
    for i in candidates:
        cosine=float(similarities[i])
        if cosine <= 0.0 or len(items)>=limit:
            break
        code=codes[i]
        if role_hints is not None and not any(h in titles[code].casefold() for h in role_hints):
            continue
        role_skills=indexed[code]
        keys=set(r['normalized_skill'] for r in role_skills)
        matched=[s for s in selected if s in keys]
        if len(matched) < min_matches: continue
        unseen = [v for v in role_skills if v['normalized_skill'] not in selected]
        unseen.sort(key=lambda v:(v['type']=='software_skill',-v['weight'],v['skill'].casefold()))
        missing=list(dict.fromkeys(v['skill'] for v in unseen))[:8]
        items.append({
            'code':code,'title':titles[code],
            'cosine_similarity':round(cosine,4),
            'entered_skill_coverage_percent':round(100*len(matched)/len(selected),1),
            'matched_skills':matched,'skills_to_explore':missing,
            'ranking_signal':round(float(combined[i]),4),
            'riasec_preference_applied':bool(requested),
            'career_interest_filter_applied':role_hints is not None,
        })
    return {
        'method':'onet-sparse-weighted-cosine-preview-v1',
        'entered_skills':selected,'entered_career_interest':interests,'items':items,
        'notes':['Experimental content similarity, not percentage of career suitability or hiring success.',
                 'Absence of a software skill is not proof it is required by an employer.',
                 'RIASEC occupation score is distinct from the user’s interest preference.',
                 'Explicit career interests are used as a cautious title filter, not a trained predictor.'],
    }
