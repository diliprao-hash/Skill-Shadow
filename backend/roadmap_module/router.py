"""Drop-in router for SkillShadow_main_improved.py. Uses its auth and SQLAlchemy session."""
import json
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, select
from sqlalchemy.orm import Session

def install(app, Base, engine, db, current_user, Profile, occupation_data, normalize_skill):
    class Roadmap(Base):
        __tablename__ = "roadmap_plans"
        id = Column(Integer, primary_key=True)
        user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
        occupation_code = Column(String(30), nullable=False)
        created_at = Column(DateTime, default=datetime.utcnow)
        updated_at = Column(DateTime, default=datetime.utcnow)
        __table_args__ = (UniqueConstraint("user_id", "occupation_code", name="uq_roadmap_user_career"),)

    class Milestone(Base):
        __tablename__ = "roadmap_milestones"
        id = Column(Integer, primary_key=True)
        roadmap_id = Column(Integer, ForeignKey("roadmap_plans.id"), nullable=False, index=True)
        skill_key = Column(String(240), nullable=False)
        skill_name = Column(String(240), nullable=False)
        category = Column(String(40), nullable=False)
        priority = Column(Integer, nullable=False)
        status = Column(String(24), default="not_started", nullable=False)
        evidence_url = Column(Text, nullable=True)
        notes = Column(Text, nullable=True)
        updated_at = Column(DateTime, default=datetime.utcnow)
        __table_args__ = (UniqueConstraint("roadmap_id", "skill_key", name="uq_roadmap_skill"),)

    Base.metadata.create_all(bind=engine, tables=[Roadmap.__table__, Milestone.__table__])
    router = APIRouter(prefix="/api/roadmaps", tags=["Adaptive Roadmaps"])

    class UpdateMilestone(BaseModel):
        status: str
        evidence_url: Optional[str] = Field(default=None, max_length=1000)
        notes: Optional[str] = Field(default=None, max_length=1000)

    class GenerateInput(BaseModel):
        occupation_code: str = Field(min_length=2, max_length=30)

    def get_plan(session, user_id, code):
        return session.scalar(select(Roadmap).where(Roadmap.user_id == user_id, Roadmap.occupation_code == code))

    def current_skills(session, user_id):
        p = session.scalar(select(Profile).where(Profile.user_id == user_id))
        try:
            raw = json.loads(p.skills or "[]") if p else []
            if not isinstance(raw, list): return set()
            return {normalize_skill(s) for s in raw if isinstance(s, str) and s.strip()}
        except (ValueError, TypeError):
            return set()

    def importance(info, category):
        if category == "software":
            flag = info.get("in_demand", False) if isinstance(info, dict) else False
            return 80 if flag is True or str(flag).lower() in ("true","yes","1") else 55
        if category == "essential":
            try:
                value = float(info.get("importance", 3)) if isinstance(info, dict) else 3.0
                return int(max(30, min(90, value * 18)))
            except (TypeError, ValueError): return 55
        return 45

    def skill_candidates(occ, student_skills):
        # O*NET software are examples, not mandatory employer requirements.
        merged = {}
        for category, field in [("software","software"),("essential","essential_skills"),("knowledge","knowledge")]:
            for name, info in (occ.get(field) or {}).items():
                key = normalize_skill(name)
                if not key or key in student_skills: continue
                score = importance(info, category)
                if key not in merged or score > merged[key]["priority"]:
                    merged[key] = {"skill_key":key, "skill_name":name, "category":category, "priority":score}
        return sorted(merged.values(), key=lambda x:(-x["priority"],x["skill_name"].lower()))

    def as_json(plan, session, student_skills):
        milestones = session.scalars(select(Milestone).where(Milestone.roadmap_id == plan.id).order_by(Milestone.priority.desc(), Milestone.id)).all()
        rows = []
        for m in milestones:
            learned = m.skill_key in student_skills
            rows.append({
                "id":m.id,"skill":m.skill_name,"category":m.category,"priority":m.priority,
                "status":m.status,"in_profile":learned,"evidence_url":m.evidence_url,
                "notes":m.notes,"updated_at":m.updated_at.isoformat() if m.updated_at else None
            })
        finished = sum(m["status"]=="completed" for m in rows)
        return {
            "occupation_code":plan.occupation_code,"plan_id":plan.id,
            "milestones":rows,"total":len(rows),"completed":finished,
            "progress_percent":round(100*finished/len(rows)) if rows else 100,
            "disclaimer":"Progress is self-reported; skill coverage and milestones are not hiring probability or verified job eligibility."
        }

    @router.get("/catalog")
    def catalog(q:str="", limit:int=30, user=Depends(current_user)):
        occ, _ = occupation_data()
        q=q.casefold().strip()
        return [{"code":o["code"],"title":o["title"]} for o in occ.values() if q in o["title"].casefold()][:max(1,min(limit,100))]

    @router.post("/generate")
    def generate(body:GenerateInput, user=Depends(current_user), session:Session=Depends(db)):
        occupations, _ = occupation_data()
        occ = occupations.get(body.occupation_code)
        if not occ: raise HTTPException(404,"Unknown O*NET occupation code")
        skills = current_skills(session,user.id)
        plan = get_plan(session,user.id,body.occupation_code)
        if not plan:
            plan = Roadmap(user_id=user.id,occupation_code=body.occupation_code)
            session.add(plan);session.flush()
        existing = {m.skill_key:m for m in session.scalars(select(Milestone).where(Milestone.roadmap_id==plan.id)).all()}
        candidates = skill_candidates(occ,skills)
        # Retain completed or in-progress milestones on regeneration, including when
        # the student has added the skill to their profile.
        for c in candidates:
            m = existing.get(c["skill_key"])
            if m:
                m.priority=c["priority"]
                m.category=c["category"]
                m.skill_name=c["skill_name"]
            else:
                session.add(Milestone(roadmap_id=plan.id,**c))
        plan.updated_at=datetime.utcnow()
        session.commit()
        return as_json(plan,session,skills)

    @router.get("/{code}")
    def read_plan(code:str,user=Depends(current_user),session:Session=Depends(db)):
        plan=get_plan(session,user.id,code)
        if not plan: raise HTTPException(404,"Generate a roadmap first")
        return as_json(plan,session,current_skills(session,user.id))

    @router.get("")
    def list_plans(user=Depends(current_user),session:Session=Depends(db)):
        occ,_=occupation_data()
        plans=session.scalars(select(Roadmap).where(Roadmap.user_id==user.id)).all()
        return [{"code":p.occupation_code,"title":occ.get(p.occupation_code,{}).get("title",p.occupation_code),
                 "progress_percent":as_json(p,session,current_skills(session,user.id))["progress_percent"]} for p in plans]

    @router.patch("/milestones/{milestone_id}")
    def update_milestone(milestone_id:int,body:UpdateMilestone,user=Depends(current_user),session:Session=Depends(db)):
        if body.status not in ("not_started","in_progress","completed"):
            raise HTTPException(422,"Invalid status")
        m=session.get(Milestone,milestone_id)
        if not m:raise HTTPException(404,"Milestone not found")
        plan=session.get(Roadmap,m.roadmap_id)
        if not plan or plan.user_id!=user.id:raise HTTPException(404,"Milestone not found")
        if body.evidence_url and not re.match(r"^https://[^\s]+$",body.evidence_url):
            raise HTTPException(422,"Evidence must be an HTTPS URL")
        m.status=body.status
        m.evidence_url=body.evidence_url
        m.notes=body.notes
        m.updated_at=datetime.utcnow()
        plan.updated_at=datetime.utcnow()
        session.commit()
        return as_json(plan,session,current_skills(session,user.id))

    app.include_router(router)
    return router
