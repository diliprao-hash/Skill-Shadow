import catalog from './catalog.json';
import { missions } from './missions';
export type Role = typeof catalog.roles[number];
export const roles = catalog.roles;
const aliases: Record<string,string> = catalog.aliases;
export const normalize = (s:string) => { const key = s.toLowerCase().replace(/[^a-z0-9+#./ -]/g,'').trim().replace(/\s+/g,' '); return aliases[key] || key; };
export const skillSet = (items:string[]) => new Set(items.map(normalize).filter(Boolean));
export const allSkills = Array.from(new Set(roles.flatMap(r=>r.skills.map(s=>s.skill)))).sort();
export type Run = {missionId:string; answers:number[]; enjoyment:number; at:string};
export type Assessment = {id:string; title:string; correct:number; total:number; at:string};
export type Evidence = {runs:Run[]; assessments:Assessment[]};
export const empty = ():Evidence => ({runs:[],assessments:[]});
const key = (scope:string) => `skillshadow.signature.v1.${scope}`;
export function readEvidence(scope:string):Evidence {
 try { const raw=JSON.parse(localStorage.getItem(key(scope)) || 'null'); if(!raw) return empty();
 const runs:Run[] = Array.isArray(raw.runs) ? raw.runs.filter((r:Run)=> {const m=missions.find(m=>m.id===r?.missionId); return m && Array.isArray(r.answers) && r.answers.length===m.tasks.length && r.answers.every((a,i)=>Number.isInteger(a)&&a>=0&&a<m.tasks[i].options.length)&&Number.isInteger(r.enjoyment)&&r.enjoyment>=1&&r.enjoyment<=5&&typeof r.at==='string';}).slice(0,100):[];
 const assessments:Assessment[]=Array.isArray(raw.assessments)?raw.assessments.filter((a:Assessment)=>a&&typeof a.id==='string'&&typeof a.title==='string'&&Number.isFinite(a.correct)&&Number.isFinite(a.total)&&a.total>0&&a.correct>=0&&a.correct<=a.total&&typeof a.at==='string').slice(0,100):[];
 return {runs,assessments}; } catch {return empty();}
}
export function writeEvidence(scope:string, value:Evidence):boolean { try {localStorage.setItem(key(scope),JSON.stringify(value));return true;} catch {return false;} }
export function latestRuns(runs:Run[]):Run[] {return runs.filter((r,i)=>runs.findIndex(x=>x.missionId===r.missionId)===i);}
export function evidenceRows(runs:Run[]) {return latestRuns(runs).flatMap(r=>{ const m=missions.find(m=>m.id===r.missionId); return m?m.tasks.map((t,i)=>({skill:t.skill,dimension:t.dimension,points:t.options[r.answers[i]].points,role:m.role,practice:t.practice})):[]; });}
export function runScore(run:Run):number {const m=missions.find(m=>m.id===run.missionId);return m?Math.round(100*m.tasks.reduce((n,t,i)=>n+t.options[run.answers[i]].points,0)/(2*m.tasks.length)):0;}
export function coverage(role:Role, skills:Set<string>):number { const total=role.skills.reduce((n,s)=>n+s.weight,0); return total?100*role.skills.reduce((n,s)=>n+(skills.has(normalize(s.skill))?s.weight:0),0)/total:0; }
export function gaps(role:Role, skills:Set<string>) {return role.skills.filter(s=>!skills.has(normalize(s.skill))).sort((a,b)=>Number(b.priority==='core')-Number(a.priority==='core')||b.weight-a.weight||a.skill.localeCompare(b.skill));}
export function rank(skills:Set<string>) {return roles.map(role=>({role,score:coverage(role,skills)})).sort((a,b)=>b.score-a.score||a.role.title.localeCompare(b.role.title));}
