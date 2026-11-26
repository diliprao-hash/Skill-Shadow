import SkillShadowIntro from "./components/SkillShadowIntro";
import DiscoveryLab from "./discovery-lab/DiscoveryLab";
import "./discovery-lab/discovery.css";
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import {
  ArrowRight, ArrowUpRight, Bookmark, BookmarkCheck,
  BriefcaseBusiness, Check, ChevronRight, Compass,
  Database, ExternalLink, FlaskConical, GraduationCap,
  Layers3, Loader2, LockKeyhole, LogOut, Mail,
  MapPin, Menu, Orbit, Plus, Route, Search,
  ShieldCheck, Sparkles, Target, UserRound, X
} from 'lucide-react';

import CareerPaths, { scorePercent, type Career, type Profile } from './CareerPaths';
import './style.css';
import Signature, { SignatureCards, isSignature, recordAssessment, type SignaturePage } from './shadow/Signature';

type Page = 'home' | 'careers' | 'jobs' | 'saved' | 'profile' | 'auth'|'discovery' | SignaturePage;
type Job = {
  job_id: number;
  title: string;
  company_name: string;
  location: string;
  formatted_work_type: string;
  annual_salary_usd_for_comparison: number | null;
  job_posting_url: string;
};
type Overview = { occupations: number; skills: number; historical_jobs: number; companies: number };
type User = { name: string; email: string };
type Saved = { code: string; title: string };
type CareerDetail = { title: string; technical: string[]; core: string[] };
const API = '/api';
const initialProfile: Profile = { skills: [], interests: '', education: '' };

async function request<T>(path: string, token?: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers
    }
  });
  const data = await response.json().catch(() => ({ detail: 'Could not reach the server.' }));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data as T;
}
const compact = (n: number | undefined) => typeof n === 'number' ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : '—';
const money = (n: number | null | undefined) => n != null && Number.isFinite(n) && n > 0
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) + '/yr'
  : 'Salary not listed';
const isHttpUrl = (url: string) => /^https?:\/\//i.test(url || '');

function App() {
  const [page, setPage] = useState<Page>('home');
  const [mobile, setMobile] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('skillshadow_token') || '');
  const [user, setUser] = useState<User | null>(null);
  const signatureScope = user && token ? 'account-' + encodeURIComponent(user.email.toLowerCase()) : token ? 'pending' : 'guest';
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [careers, setCareers] = useState<Career[]>([]);
  const [careersLoading, setCareersLoading] = useState(false);
  const [careersError, setCareersError] = useState('');
  const [saved, setSaved] = useState<Saved[]>([]);
  const [selectedCareer, setSelectedCareer] = useState<Career | null>(null);
  const [careerDetail, setCareerDetail] = useState<CareerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobSearch, setJobSearch] = useState('Data');
  const [location, setLocation] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobCount, setJobCount] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const navigate = (p: Page) => { setPage(p); setMobile(false); setNotice(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const notify = (text: string, error = false) => setNotice({ text, error });
  const updateProfile = (change: Partial<Profile>) => setProfile(p => ({ ...p, ...change }));
  const addSkill = (value: string) => {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) setProfile(p => ({...p, skills: Array.from(new Set([...p.skills, ...parts].filter((skill, index, arr) => arr.findIndex(x => x.toLowerCase() === skill.toLowerCase()) === index)))}));
    setSkillSearch(''); setSuggestions([]);
  };
  const removeSkill = (value: string) => updateProfile({ skills: profile.skills.filter(s => s !== value) });

  useEffect(() => {
    request<Overview>('/overview').then(setOverview).catch(() => {/* Show placeholders if API is offline. */});
  }, []);
  useEffect(() => {
    if (!token) { setUser(null); setSaved([]); return; }
    let active = true;
    request<User>('/me', token).then(u => { if (active) setUser(u); }).catch(() => { if (active) logout(); });
    request<Profile>('/profile', token).then(p => { if (active) setProfile({ ...initialProfile, ...p, skills: Array.isArray(p.skills) ? p.skills : [] }); }).catch(() => {});
    request<Saved[]>('/saved', token).then(s => { if (active) setSaved(Array.isArray(s) ? s : []); }).catch(() => {});
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!skillSearch.trim()) { setSuggestions([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      request<string[]>('/skills?q=' + encodeURIComponent(skillSearch) + '&limit=12')
        .then(data => { if (active) setSuggestions(Array.isArray(data) ? data : []); }).catch(() => {});
    }, 230);
    return () => { active = false; clearTimeout(timer); };
  }, [skillSearch]);

  useEffect(() => {
    if (!profile.skills.length && !profile.interests.trim()) { setCareers([]); setCareersError(''); setCareersLoading(false); return; }
    const controller = new AbortController();
    setCareersLoading(true); setCareersError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          skills: profile.skills.join(','), interests: profile.interests,
          education: profile.education, limit: '18'
        });
        const result = await request<Career[]>(`/careers-curated?${params}`, undefined, { signal: controller.signal });
        if (!controller.signal.aborted) setCareers(Array.isArray(result) ? result : []);
      } catch (err) {
        if (!controller.signal.aborted) { setCareersError((err as Error).message); setCareers([]); }
      } finally { if (!controller.signal.aborted) setCareersLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [profile.skills, profile.interests, profile.education]);

  useEffect(() => {
    if (page !== 'jobs') return;
    let active = true;
    setJobsLoading(true); setJobsError('');
    const timer = setTimeout(() => request<{ total: number; items: Job[] }>(
      '/jobs?q=' + encodeURIComponent(jobSearch) + '&location=' + encodeURIComponent(location))
      .then(data => { if (active) { setJobs(Array.isArray(data.items) ? data.items : []); setJobCount(data.total || 0); } })
      .catch(err => { if (active) { setJobsError((err as Error).message); setJobs([]); } })
      .finally(() => { if (active) setJobsLoading(false); }), 320);
    return () => { active = false; clearTimeout(timer); };
  }, [page, jobSearch, location]);

  useEffect(() => {
    if (!selectedCareer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedCareer(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCareer]);

  const logout = () => {
    localStorage.removeItem('skillshadow_token'); setToken(''); setUser(null); setSaved([]); setPage('home');
  };
  const submitAuth = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice(null);
    try {
      const data = await request<{ token: string; user: User }>('/auth/' + authMode, undefined, { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('skillshadow_token', data.token); setToken(data.token); setUser(data.user);
      navigate('profile'); notify('Welcome to SkillShadow!');
    } catch (err) { notify((err as Error).message, true); }
    finally { setBusy(false); }
  };
  const saveProfile = async () => {
    if (!token) { setAuthMode('register'); navigate('auth'); notify('Sign in to save your profile.'); return; }
    setBusy(true);
    try { await request('/profile', token, { method: 'PUT', body: JSON.stringify(profile) }); notify('Your profile has been saved.'); }
    catch (err) { notify((err as Error).message, true); }
    finally { setBusy(false); }
  };
  const toggleSaved = async (c: Career) => {
    if (!token) { setAuthMode('login'); navigate('auth'); notify('Sign in to bookmark careers.'); return; }
    const exists = saved.some(s => s.code === c.code);
    try {
      await request('/saved' + (exists ? '/' + encodeURIComponent(c.code) : ''), token,
        { method: exists ? 'DELETE' : 'POST', ...(!exists ? { body: JSON.stringify({ occupation_code: c.code }) } : {}) });
      setSaved(old => exists ? old.filter(s => s.code !== c.code) : [...old, { code: c.code, title: c.title }]);
      notify(exists ? 'Career removed from saved.' : 'Career added to saved.');
    } catch (err) { notify((err as Error).message, true); }
  };
  const openCareer = async (career: Career) => {
    setSelectedCareer(career); setCareerDetail(null); setDetailLoading(true);
    try {
      const data = await request<Record<string, unknown>>('/careers-curated/' + encodeURIComponent(career.code));
      const arrayStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
      setCareerDetail({
        title: typeof data.title === 'string' ? data.title : career.title,
        technical: arrayStrings(data.technical ?? data.technical_skills),
        core: arrayStrings(data.core ?? data.core_skills)
      });
    } catch (err) { notify((err as Error).message, true); }
    finally { setDetailLoading(false); }
  };

  const savedCodes = useMemo(() => saved.map(s => s.code), [saved]);
  const missingSkills = useMemo(() => {
    const existing = new Set(profile.skills.map(s => s.trim().toLowerCase()));
    return [...(careerDetail?.technical || []), ...(careerDetail?.core || [])]
      .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)
      .filter(s => !existing.has(s.toLowerCase()));
  }, [careerDetail, profile.skills]);

 
return (
  <div className="ss-site">
    
<SkillShadowIntro playOncePerSession={false} />


    <div className="ss-background" aria-hidden="true" />
    <header className="ss-navbar">

        <div className="ss-nav-inner">
          <button className="ss-brand" type="button" onClick={() => navigate('home')} aria-label="SkillShadow home">
            <span className="ss-brand-mark"><Orbit size={23} strokeWidth={2.2}/></span>
            <span>Skill<span>Shadow</span><small>YOUR FUTURE, DECODED</small></span>
          </button>
          <nav className="ss-desktop-nav" aria-label="Main navigation">
            <button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button>
            <button className={page === 'careers' ? 'active' : ''} onClick={() => navigate('careers')}>Career Paths</button>

<button
  className={page === 'discovery' ? 'active' : ''}
  onClick={() => navigate('discovery')}
>
  Discovery Lab
</button>

            <button className={page === 'jobs' ? 'active' : ''} onClick={() => navigate('jobs')}>Opportunities</button>
            <button className={page === 'saved' ? 'active' : ''} onClick={() => navigate('saved')}>Saved</button>
            <a href="/roadmap.html"><Route size={15}/> Roadmap</a>
          </nav>
          <div className="ss-nav-actions">
            <button className="ss-profile-shortcut" onClick={() => navigate(user ? 'profile' : 'auth')}><UserRound size={17}/><span>{user ? user.name.split(' ')[0] : 'Sign in'}</span></button>
            <button className="ss-btn ss-btn-primary ss-header-cta" onClick={() => navigate('careers')}>Explore paths <ArrowUpRight size={16}/></button>
            <button className="ss-mobile-toggle" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation">{mobile ? <X/> : <Menu/>}</button>
          </div>
        </div>
      
{mobile && (
  <nav className="ss-mobile-nav" aria-label="Mobile navigation">
    {([
      ['home', 'Home'],
      ['careers', 'Career Paths'],
      ['jobs', 'Opportunities'],
      ['saved', 'Saved'],
      ['profile', 'My Profile'],
      ['discovery', 'Discovery Lab'],
      ['shadowlife', 'ShadowLife'],
      ['shadowtwin', 'ShadowTwin'],
      ['shadowverse', 'ShadowVerse']
    ] as [Page, string][]).map(([p, label]) => (
      <button key={p} onClick={() => navigate(p)}>
        {p === 'discovery' && <FlaskConical size={17} />}
        {label}
        <ChevronRight size={17} />
      </button>
    ))}

    <a href="/roadmap.html">
      Learning Roadmap
      <Route size={17} />
    </a>
  </nav>
)}

      </header>

      <AnimatePresence mode="wait">
        <motion.main key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: .22 }}>
          {page === 'home' && <>
            <section className="ss-hero ss-page-wrap">
              <div className="ss-hero-copy">
                <div className="ss-eyebrow"><Sparkles size={15}/> YOUR FUTURE IS FULL OF POSSIBILITIES</div>
                <h1>Talent is everywhere.<br/><span>Direction changes</span><br/>everything<span className="ss-period">.</span></h1>
                <p>You already have potential. We'll help you see where it can take you — with career matches, real occupational data, and a clearer path forward.</p>
                <div className="ss-hero-actions">
                  <button className="ss-btn ss-btn-primary ss-btn-lg" onClick={() => navigate('careers')}>Explore my universe <ArrowUpRight size={19}/></button>
                  <button className="ss-btn ss-btn-ghost ss-btn-lg" onClick={() => navigate('profile')}>Build my profile <ArrowRight size={19}/></button>
                </div>
                <div className="ss-hero-proof"><ShieldCheck size={17}/> Based on occupational information. Your journey, your pace.</div>
              </div>
              <div className="ss-universe" aria-hidden="true">
                <div className="ss-orbit-ring ring-one"/><div className="ss-orbit-ring ring-two"/><div className="ss-orbit-ring ring-three"/>
                <div className="ss-planet-glow"/><div className="ss-planet"><Orbit size={67} strokeWidth={1.1}/></div>
                <div className="ss-orbit-star star-one">✧</div><div className="ss-orbit-star star-two">✦</div><div className="ss-orbit-star star-three">✧</div>
                <div className="ss-orbit-tag tag-top"><span className="ss-tiny-dot"/> YOUR SKILLS</div>
                <div className="ss-orbit-tag tag-bottom">INFINITE POSSIBILITIES <span className="ss-tiny-dot"/></div>
                <div className="ss-float-label float-one"><span><Target size={16}/></span><div>Discover strengths<small>Know your edge</small></div></div>
                <div className="ss-float-label float-two"><span><Compass size={16}/></span><div>Find your direction<small>Move with purpose</small></div></div>
              </div>
            </section>
            <section className="ss-stats ss-page-wrap" aria-label="Database overview">
              <div><span className="ss-stats-icon"><GraduationCap size={20}/></span><strong>{compact(overview?.occupations)}</strong><small>Occupations</small></div>
              <div><span className="ss-stats-icon"><Layers3 size={20}/></span><strong>{compact(overview?.skills)}</strong><small>Mapped skills</small></div>
              <div><span className="ss-stats-icon"><BriefcaseBusiness size={20}/></span><strong>{compact(overview?.historical_jobs)}</strong><small>Historical job records</small></div>
              <div><span className="ss-stats-icon"><Database size={20}/></span><strong>{compact(overview?.companies)}</strong><small>Companies in data</small></div>
            </section>
            <section className="ss-features ss-page-wrap">
              <div className="ss-section-heading"><div><span className="ss-small-label">THE SKILLSHADOW EXPERIENCE</span><h2>Live your career.<br/><em>Explore who you could become.</em></h2></div><p>Try a workplace mission, build your evidence profile, and compare possible futures.</p></div>
              <SignatureCards navigate={navigate}/>

            </section>
            <section className="ss-journey ss-page-wrap"><div className="ss-journey-left"><span className="ss-small-label">BUILT AROUND YOU</span><h2>Not just where<br/>you could go.<br/><em>How to get there.</em></h2><button className="ss-btn ss-btn-primary" onClick={() => navigate('profile')}>Start with your skills <ArrowRight size={17}/></button></div><div className="ss-steps">
              {[['01','Show us your skills','Bring what you already know — every skill counts.'],['02','See matched career paths','Review recommendations calculated by the backend.'],['03','Explore your next move','Review occupation details, skill gaps, and opportunities.']].map(([n,h,p]) => <div className="ss-step" key={n}><span>{n}</span><div><h3>{h}</h3><p>{p}</p></div><Check size={17}/></div>)}
            </div></section>
          </>}

{page === 'discovery' && <DiscoveryLab onCompleted={(result, title) => {
  if (signatureScope !== 'pending' && !recordAssessment(signatureScope, {id:result.category_id,title,correct:result.correct,total:result.total,at:new Date().toISOString()})) notify('Assessment completed, but local evidence could not be saved.', true);
}} />}
          {isSignature(page) && (signatureScope === 'pending' ? <div className="ss-page-wrap ss-interior-page"><p>Loading your account…</p></div> : <Signature key={`${page}:${signatureScope}`} page={page} scope={signatureScope} profile={profile} navigate={navigate}/>)}

          {page === 'careers' && <CareerPaths profile={profile} updateProfile={updateProfile} careers={careers} loading={careersLoading} error={careersError} suggestions={suggestions} skillSearch={skillSearch} setSkillSearch={setSkillSearch} addSkill={addSkill} removeSkill={removeSkill} savedCodes={savedCodes} openCareer={openCareer} toggleSaved={toggleSaved} saveProfile={saveProfile} isLoggedIn={Boolean(token)}/>}

          {page === 'jobs' && <div className="ss-page-wrap ss-interior-page"><div className="ss-page-intro"><span className="ss-eyebrow"><BriefcaseBusiness size={15}/> EXPLORE THE WORLD OF WORK</span><h1>Opportunities worth <em>exploring.</em></h1><p>Search the job records available in your SkillShadow database. Results and salary figures come from your connected backend.</p></div>
            <div className="ss-job-filters ss-glass"><div className="ss-search-field"><Search size={20}/><input aria-label="Job title" value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="Job title or keyword"/></div><div className="ss-search-field"><MapPin size={20}/><input aria-label="Job location" value={location} onChange={e => setLocation(e.target.value)} placeholder="City or location"/></div><div className="ss-job-count">{jobsLoading ? 'Searching…' : `${jobCount.toLocaleString()} matching records`}</div></div>
            {jobsError && <div className="ss-error-banner">{jobsError}</div>}
            {jobsLoading ? <div className="ss-empty-state"><Loader2 className="ss-spin" size={36}/><h3>Searching opportunities…</h3></div> : jobs.length ? <div className="ss-job-grid">{jobs.map((job, i) => <article className="ss-job-card ss-glass" key={`${job.job_id}-${i}`}><div className="ss-job-top"><span className="ss-job-icon"><BriefcaseBusiness size={23}/></span><span className="ss-work-tag">{job.formatted_work_type || 'Work type not listed'}</span></div><h3>{job.title}</h3><p className="ss-job-company">{job.company_name || 'Company not listed'}</p><div className="ss-job-meta"><span><MapPin size={15}/>{job.location || 'Location not listed'}</span><span>{money(job.annual_salary_usd_for_comparison)}</span></div>{isHttpUrl(job.job_posting_url) ? <a href={job.job_posting_url} target="_blank" rel="noopener noreferrer" className="ss-job-open">View job listing <ExternalLink size={17}/></a> : <span className="ss-job-unavailable">External listing unavailable</span>}</article>)}</div> : <div className="ss-empty-state"><Search size={36}/><h3>No job records found.</h3><p>Try a broader search term, or check the connection to your backend.</p></div>}
            <p className="ss-source-disclaimer">Job records may be historical. Verify current availability and salary details with the employer.</p>
          </div>}

          {page === 'saved' && <div className="ss-page-wrap ss-interior-page"><div className="ss-page-intro"><span className="ss-eyebrow"><Bookmark size={15}/> YOUR SHORTLIST</span><h1>Save what <em>inspires you.</em></h1><p>Keep interesting career paths within reach and return when you're ready to learn more.</p></div>{!token ? <div className="ss-empty-state"><Bookmark size={35}/><h3>Your saved paths belong to you.</h3><p>Sign in to save and revisit careers across sessions.</p><button className="ss-btn ss-btn-primary" onClick={() => navigate('auth')}>Sign in <ArrowRight size={17}/></button></div> : saved.length ? <div className="ss-saved-grid">{saved.map(c => <div className="ss-saved-card ss-glass" key={c.code}><span className="ss-saved-icon"><BookmarkCheck size={25}/></span><h3>{c.title}</h3><p>Occupation code: {c.code}</p><div className="ss-saved-actions"><button className="ss-btn ss-btn-ghost" onClick={() => openCareer({ code:c.code, title:c.title, match_score:0, matched_skills:[], technical_count:0, core_count:0 })}>Explore <ArrowRight size={16}/></button><button className="ss-icon-btn" aria-label={`Remove ${c.title} from saved`} onClick={() => toggleSaved({ code:c.code, title:c.title, match_score:0, matched_skills:[], technical_count:0, core_count:0 })}><X size={18}/></button></div></div>)}</div> : <div className="ss-empty-state"><Bookmark size={35}/><h3>No saved careers yet.</h3><p>Discover careers that interest you and tap the bookmark icon to keep them here.</p><button className="ss-btn ss-btn-primary" onClick={() => navigate('careers')}>Browse career paths <ArrowRight size={17}/></button></div>}</div>}

          {page === 'profile' && <div className="ss-page-wrap ss-interior-page"><div className="ss-page-intro"><span className="ss-eyebrow"><UserRound size={15}/> YOUR STARTING POINT</span><h1>Every skill tells <em>a story.</em></h1><p>Capture what you know. Your SkillShadow career matches will adapt as your profile changes.</p></div><div className="ss-profile-layout"><div className="ss-profile-card ss-glass"><div className="ss-profile-card-header"><span className="ss-icon-square"><UserRound size={20}/></span><div><h2>{user ? `Welcome, ${user.name}` : 'Build your profile'}</h2><p>{user?.email || 'Your profile is editable even before signing in.'}</p></div></div><label className="ss-label" htmlFor="profile-skill">Skills & strengths</label><div className="cp-skill-box"><div className="cp-chip-list">{profile.skills.map(skill => <span className="cp-skill-chip" key={skill}>{skill}<button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}><X size={13}/></button></span>)}</div><div className="cp-skill-entry"><Plus size={17}/><input id="profile-skill" value={skillSearch} onChange={e => setSkillSearch(e.target.value)} onKeyDown={e => {if(e.key==='Enter' || e.key===','){e.preventDefault();addSkill(skillSearch);}}} placeholder="Add a skill and press Enter" /></div></div><label className="ss-label" htmlFor="profile-interest">Career interests</label><input className="ss-input" id="profile-interest" value={profile.interests} onChange={e => updateProfile({ interests:e.target.value })} placeholder="What interests you?"/><label className="ss-label" htmlFor="profile-education">Education</label><select className="ss-input ss-select" id="profile-education" value={profile.education} onChange={e => updateProfile({ education:e.target.value })}><option value="">Choose your education</option><option value="high school">High school</option><option value="diploma">Diploma</option><option value="bachelors">Bachelor's degree</option><option value="masters">Master's degree</option><option value="doctorate">Doctorate</option><option value="other">Other / self-taught</option></select><button className="ss-btn ss-btn-primary ss-full-btn" onClick={saveProfile} disabled={busy}>{busy ? <Loader2 className="ss-spin" size={18}/> : <Check size={18}/>} {token ? 'Save profile' : 'Create account to save'}</button>{user && <button className="ss-signout" onClick={logout}><LogOut size={16}/> Sign out</button>}</div><aside className="ss-profile-aside"><span className="ss-small-label">YOUR SKILL SIGNAL</span><strong>{profile.skills.length.toString().padStart(2,'0')}</strong><h3>Skills in your profile</h3><p>Every skill helps refine the recommendations you see in Career Paths.</p><button className="ss-btn ss-btn-ghost" onClick={() => navigate('careers')}>Find my career paths <ArrowUpRight size={17}/></button><div className="ss-aside-orb"><Orbit size={95} strokeWidth={.8}/></div></aside></div></div>}

          {page === 'auth' && <div className="ss-auth-section ss-page-wrap"><div className="ss-auth-message"><span className="ss-eyebrow"><Sparkles size={15}/> START YOUR JOURNEY</span><h1>Your future looks <em>bright from here.</em></h1><p>Create an account to save your profile and bookmark career paths. Or sign in to pick up where you left off.</p><div className="ss-auth-orbit"><Orbit size={120} strokeWidth={0.7}/></div></div><div className="ss-auth-card ss-glass"><div className="ss-auth-tabs"><button className={authMode==='register'?'active':''} onClick={() => setAuthMode('register')}>Create account</button><button className={authMode==='login'?'active':''} onClick={() => setAuthMode('login')}>Sign in</button></div><h2>{authMode==='register'?'Join SkillShadow':'Welcome back'}</h2><p>{authMode==='register'?'A better career journey starts with one step.':'Pick up your career journey where you left off.'}</p><form onSubmit={submitAuth}>{authMode==='register' && <><label className="ss-label" htmlFor="auth-name">Your name</label><div className="ss-field-with-icon"><UserRound size={17}/><input id="auth-name" required autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name:e.target.value })} placeholder="Enter your name"/></div></>}<label className="ss-label" htmlFor="auth-email">Email address</label><div className="ss-field-with-icon"><Mail size={17}/><input id="auth-email" required type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email:e.target.value })} placeholder="you@example.com"/></div><label className="ss-label" htmlFor="auth-password">Password</label><div className="ss-field-with-icon"><LockKeyhole size={17}/><input id="auth-password" required type="password" minLength={6} autoComplete={authMode==='register'?'new-password':'current-password'} value={form.password} onChange={e => setForm({ ...form, password:e.target.value })} placeholder="Enter your password"/></div><button className="ss-btn ss-btn-primary ss-full-btn" type="submit" disabled={busy}>{busy ? <Loader2 className="ss-spin" size={18}/> : <ArrowRight size={18}/>} {authMode==='register'?'Create my account':'Sign in'}</button></form><p className="ss-auth-footnote"><ShieldCheck size={15}/> Your account is managed by your SkillShadow backend.</p></div></div>}
        </motion.main>
      </AnimatePresence>

      <footer className="ss-footer"><div className="ss-page-wrap ss-footer-inner"><div><div className="ss-footer-brand"><Orbit size={22}/> SkillShadow</div><p>See your potential. Find your direction.</p></div><div className="ss-footer-links"><button onClick={() => navigate('home')}>Home</button><button onClick={() => navigate('careers')}>Career Paths</button><button onClick={() => navigate('jobs')}>Opportunities</button><a href="/roadmap.html">Roadmap</a></div><span className="ss-footer-note">Built for the next generation of dreamers.</span></div></footer>

      <AnimatePresence>{notice && <motion.div className={'ss-toast' + (notice.error ? ' ss-toast-error' : '')} role="status" initial={{ opacity:0, y:25 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:25 }}><span>{notice.error ? <X size={18}/> : <Check size={18}/>}</span><p>{notice.text}</p><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={17}/></button></motion.div>}</AnimatePresence>

      <AnimatePresence>{selectedCareer && <motion.div className="ss-modal-overlay" role="presentation" onMouseDown={e => { if (e.target===e.currentTarget) setSelectedCareer(null); }} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}><motion.section className="ss-detail-modal" role="dialog" aria-modal="true" aria-label={`Details for ${selectedCareer.title}`} initial={{ opacity:0, y:20, scale:.97 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:15, scale:.97 }}><button className="ss-modal-close" onClick={() => setSelectedCareer(null)} aria-label="Close career details"><X size={21}/></button><span className="ss-eyebrow"><Compass size={15}/> CAREER DEEP DIVE</span><h2>{careerDetail?.title || selectedCareer.title}</h2><p className="ss-modal-code">Occupation code: {selectedCareer.code}</p>{selectedCareer.matched_skills?.length > 0 && <span className="ss-modal-score"><Target size={17}/>{scorePercent(selectedCareer.match_score)}% profile match</span>}{detailLoading ? <div className="ss-modal-loading"><Loader2 className="ss-spin"/> Loading occupation details…</div> : careerDetail ? <><div className="ss-detail-columns"><div><h3>Technical skills</h3><div className="ss-detail-tags">{careerDetail.technical.length ? careerDetail.technical.map(x => <span key={x}>{x}</span>) : <p>No technical skills returned.</p>}</div></div><div><h3>Core skills</h3><div className="ss-detail-tags">{careerDetail.core.length ? careerDetail.core.map(x => <span key={x}>{x}</span>) : <p>No core skills returned.</p>}</div></div></div><div className="ss-gap-section"><h3><Target size={18}/> Skills you could build next</h3>{missingSkills.length ? <div className="ss-detail-tags">{missingSkills.slice(0,12).map(x => <span key={x}>{x}</span>)}</div> : <p>No unmatched skills found from the details returned. This is not a certification of job readiness.</p>}</div></> : <p className="ss-modal-code">Career requirements aren't available from the backend right now.</p>}<div className="ss-modal-actions"><button className="ss-btn ss-btn-primary" onClick={() => { const c = selectedCareer; setSelectedCareer(null); toggleSaved(c); }}>{savedCodes.includes(selectedCareer.code) ? <BookmarkCheck size={17}/> : <Bookmark size={17}/>} {savedCodes.includes(selectedCareer.code) ? 'Remove saved career' : 'Save career'}</button>
<a
  className="ss-btn ss-btn-ghost"
  href={`/roadmap.html?career=${encodeURIComponent(selectedCareer.title)}`}
>
  Learning roadmap <ArrowRight size={17}/>
</a>
</div></motion.section></motion.div>}</AnimatePresence>
    </div>
  );
}

export default App;
