import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, Bookmark, BookmarkCheck, Check, ChevronRight,
  Compass, GraduationCap, Loader2, Plus, Search, SlidersHorizontal,
  Sparkles, Target, X
} from 'lucide-react';

export type Career = {
  code: string;
  title: string;
  match_score: number;
  matched_skills: string[];
  technical_count: number;
  core_count: number;
};

export type Profile = {
  skills: string[];
  interests: string;
  education: string;
};

type Props = {
  profile: Profile;
  updateProfile: (change: Partial<Profile>) => void;
  careers: Career[];
  loading: boolean;
  error: string;
  suggestions: string[];
  skillSearch: string;
  setSkillSearch: (value: string) => void;
  addSkill: (value: string) => void;
  removeSkill: (value: string) => void;
  savedCodes: string[];
  openCareer: (career: Career) => void;
  toggleSaved: (career: Career) => void;
  saveProfile: () => void;
  isLoggedIn: boolean;
};

export function scorePercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw > 0 && raw <= 1 ? raw * 100 : raw)));
}

export default function CareerPaths({
  profile, updateProfile, careers, loading, error, suggestions,
  skillSearch, setSkillSearch, addSkill, removeSkill,
  savedCodes, openCareer, toggleSaved, saveProfile, isLoggedIn
}: Props) {
  const [careerQuery, setCareerQuery] = useState('');
  const [order, setOrder] = useState<'match' | 'az'>('match');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const hasInputs = profile.skills.length > 0 || profile.interests.trim().length > 0;

  const visible = useMemo(() => {
    const q = careerQuery.toLowerCase().trim();
    return careers
      .filter(c => !q || c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .sort((a, b) => order === 'az'
        ? a.title.localeCompare(b.title)
        : scorePercent(b.match_score) - scorePercent(a.match_score));
  }, [careers, careerQuery, order]);

  return (
    <div className="cp-page ss-page-wrap">
      <motion.div className="ss-page-intro" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}>
        <span className="ss-eyebrow"><Sparkles size={14} /> THE FUTURE ISN'T ONE-SIZE-FITS-ALL</span>
        <h1>Find the career that <em>fits your universe.</em></h1>
        <p>Tell us what you know and what excites you. Explore careers ranked using your profile and our occupational data — never made-up sample results.</p>
      </motion.div>

      <div className="cp-layout">
        <aside className="cp-filter-panel ss-glass">
          <div className="cp-panel-title"><span className="ss-icon-square"><SlidersHorizontal size={18}/></span><div><h2>Your career compass</h2><p>Shape your recommendations</p></div></div>

          <label className="ss-label" htmlFor="cp-skill">Your skills</label>
          <div className="cp-skill-box">
            <div className="cp-chip-list">
              {profile.skills.map(skill => (
                <span className="cp-skill-chip" key={skill}>{skill}<button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}><X size={13}/></button></span>
              ))}
            </div>
            <div className="cp-skill-entry">
              <Plus size={16} />
              <input id="cp-skill" value={skillSearch} placeholder="Type a skill, then Enter" autoComplete="off"
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                onChange={e => { setSkillSearch(e.target.value); setSuggestionsOpen(true); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(skillSearch); setSuggestionsOpen(false); } }}/>
            </div>
            {suggestionsOpen && skillSearch.trim() && suggestions.filter(s => !profile.skills.some(x => x.toLowerCase() === s.toLowerCase())).length > 0 && (
              <div className="cp-suggestions" role="listbox">
                {suggestions.filter(s => !profile.skills.some(x => x.toLowerCase() === s.toLowerCase())).slice(0, 6).map(s => (
                  <button key={s} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { addSkill(s); setSuggestionsOpen(false); }}>{s}<Plus size={14}/></button>
                ))}
              </div>
            )}
          </div>
          <p className="cp-field-hint">Press Enter to add each skill.</p>

          <label className="ss-label" htmlFor="cp-interest">Areas you're interested in</label>
          <input className="ss-input" id="cp-interest" value={profile.interests} onChange={e => updateProfile({ interests: e.target.value })} placeholder="e.g. data, design, healthcare" />

          <label className="ss-label" htmlFor="cp-education">Your education</label>
          <select className="ss-input ss-select" id="cp-education" value={profile.education} onChange={e => updateProfile({ education: e.target.value })}>
            <option value="">Choose your education</option>
            <option value="high school">High school</option>
            <option value="diploma">Diploma</option>
            <option value="bachelors">Bachelor's degree</option>
            <option value="masters">Master's degree</option>
            <option value="doctorate">Doctorate</option>
            <option value="other">Other / self-taught</option>
          </select>

          <button className="ss-btn ss-btn-primary cp-save-btn" type="button" onClick={saveProfile}>{isLoggedIn ? 'Save my profile' : 'Sign in to save'} <ArrowRight size={17}/></button>
          <div className="cp-source-note"><Check size={15} /> Recommendations are returned by your backend.</div>
        </aside>

        <section className="cp-results">
          <div className="cp-results-top">
            <div><span className="ss-small-label">YOUR POSSIBILITIES</span><h2>Recommended career paths</h2><p>Explore matches, discover skill gaps, and plan your next move.</p></div>
            {hasInputs && <span className="cp-results-count">{loading ? 'Finding matches…' : `${visible.length} paths`}</span>}
          </div>

          <div className="cp-toolbar">
            <div className="ss-search-field"><Search size={18}/><input aria-label="Search recommended careers" placeholder="Search recommended careers…" value={careerQuery} onChange={e => setCareerQuery(e.target.value)}/></div>
            <select className="ss-input ss-sort" aria-label="Sort careers" value={order} onChange={e => setOrder(e.target.value as 'match'|'az')}><option value="match">Best match</option><option value="az">Name A–Z</option></select>
          </div>

          {error && <div className="ss-error-banner">{error}</div>}

          {!hasInputs ? (
            <div className="ss-empty-state cp-empty"><span className="ss-empty-art"><Compass size={35}/></span><h3>Your next chapter starts here.</h3><p>Add a skill or an interest on the left to discover career paths. Recommendations appear here when your backend responds.</p><span className="ss-quiet-pill"><Target size={14}/> Personalized, not pre-filled</span></div>
          ) : loading ? (
            <div className="ss-empty-state cp-empty"><Loader2 className="ss-spin" size={36}/><h3>Connecting the dots…</h3><p>Looking for careers that align with your profile.</p></div>
          ) : visible.length === 0 ? (
            <div className="ss-empty-state cp-empty"><Search size={34}/><h3>No matches to show yet.</h3><p>{careerQuery ? 'Try a different career search.' : 'Try adding more skills or interests. Also check that your FastAPI backend is running.'}</p></div>
          ) : (
            <div className="cp-career-grid">
              {visible.map((career, index) => {
                const score = scorePercent(career.match_score);
                const isSaved = savedCodes.includes(career.code);
                return <motion.article className="cp-career-card ss-glass" key={career.code}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.035, 0.35) }}>
                  <div className="cp-card-top"><span className="cp-card-icon"><GraduationCap size={23}/></span><button className="ss-icon-btn" type="button" aria-label={isSaved ? `Unsave ${career.title}` : `Save ${career.title}`} onClick={() => toggleSaved(career)}>{isSaved ? <BookmarkCheck size={20}/> : <Bookmark size={20}/>}</button></div>
                  <h3>{career.title}</h3><p className="cp-code">Occupation code: {career.code}</p>
                  <div className="cp-score-row"><span>Profile match</span><strong>{score}%</strong></div>
                  <div className="cp-progress-track"><span style={{width: `${score}%`}}/></div>
                  <div className="cp-matches">{career.matched_skills?.length ? career.matched_skills.slice(0,3).map(s => <span className="cp-match-chip" key={s}><Check size={12}/>{s}</span>) : <span className="cp-muted">Explore career requirements</span>}</div>
                  <button className="cp-explore" type="button" onClick={() => openCareer(career)}>Explore this path <ArrowUpRight size={17}/></button>
                </motion.article>;
              })}
            </div>
          )}
        </section>
      </div>
      <div className="cp-next-note"><Sparkles size={17}/><span>Already know where you want to go? Explore your <a href="/roadmap.html">learning roadmap <ChevronRight size={14}/></a></span></div>
    </div>
  );
}
