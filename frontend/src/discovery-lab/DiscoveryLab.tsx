import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { discoveryApi } from './api'
import type { Category, Question, ScoreResult } from './types'

type Screen = 'home' | 'quiz' | 'results'

type GlyphName = 'brain' | 'chart' | 'puzzle' | 'sparkles' | 'message' | 'target' | 'arrow' | 'check' | 'chevron' | 'rotate' | 'bolt' | 'clock' | 'shield' | 'book' | 'grid' | 'x'

function Glyph({ name, size = 22 }: { name: GlyphName | string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  const paths: Record<GlyphName, ReactNode> = {
    brain: <><path d="M12 7a4 4 0 0 0-7.7-1.5A4 4 0 0 0 4 12a4.5 4.5 0 0 0 2 7.8A4 4 0 0 0 12 21V7Z"/><path d="M12 7a4 4 0 0 1 7.7-1.5A4 4 0 0 1 20 12a4.5 4.5 0 0 1-2 7.8A4 4 0 0 1 12 21V7Z"/><path d="M8 9c-2 0-3 1-3 3m3 3c-1 1-1 2-1 3m9-9c2 0 3 1 3 3m-3 3c1 1 1 2 1 3"/></>,
    chart: <><path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 2 5-7"/><path d="M16 6h3v3"/></>,
    puzzle: <><path d="M20 13v6a1 1 0 0 1-1 1h-6v-2a2 2 0 0 0-4 0v2H5a1 1 0 0 1-1-1v-5h2a2 2 0 0 0 0-4H4V5a1 1 0 0 1 1-1h5v2a2 2 0 0 0 4 0V4h5a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2Z"/></>,
    sparkles: <><path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/><path d="m19 2 .6 1.4L21 4l-1.4.6L19 6l-.6-1.4L17 4l1.4-.6L19 2Z"/></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8.3 8.3 0 0 1-3-.6L4 20l1.6-4.4A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8m-8 3h5"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    chevron: <><path d="m15 18-6-6 6-6"/></>,
    rotate: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></>,
    bolt: <><path d="m13 2-9 12h7l-1 8 10-12h-7V2Z"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20M8 7h8m-8 4h6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    x: <><path d="M18 6 6 18M6 6l12 12"/></>,
  }
  return <svg {...common}>{paths[name as GlyphName] ?? paths.bolt}</svg>
}

const featureCards = [
  { icon: 'bolt', title: 'Small challenges', desc: 'Learn about your approach to problems.' },
  { icon: 'chart', title: 'Clear feedback', desc: 'Review your answers and reasoning.' },
  { icon: 'target', title: 'Career exploration', desc: 'Connect results to SkillShadow later.' },
]

export default function DiscoveryLab() {
  const [screen, setScreen] = useState<Screen>('home')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('logical_reasoning')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadCategories = async () => {
    setLoading(true)
    setError('')
    try { setCategories(await discoveryApi.categories()) }
    catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadCategories() }, [])

  const selectedCategory = categories.find(item => item.id === categoryId)
  const question = questions[step]
  const answered = useMemo(() => questions.filter(q => answers[q.id] !== undefined).length, [questions, answers])
  const progress = questions.length ? (answered / questions.length) * 100 : 0

  async function startAssessment(id: string) {
    setError('')
    setBusy(true)
    try {
      const data = await discoveryApi.questions(id)
      setCategoryId(id)
      setQuestions(data.questions)
      setAnswers({})
      setResult(null)
      setStep(0)
      setScreen('quiz')
    } catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }

  async function submit() {
    if (answered !== questions.length) return
    setBusy(true)
    setError('')
    try {
      const data = await discoveryApi.submit(categoryId, answers)
      setResult(data)
      setScreen('results')
    } catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }

  function goHome() {
    setScreen('home')
    setResult(null)
    setError('')
  }

  return (
    <div className="ss-app">
      <div className="ss-orb ss-orb-one" aria-hidden="true" />
      <div className="ss-orb ss-orb-two" aria-hidden="true" />
      <div className="ss-shell">
        <header className="ss-topbar">
          <button type="button" className="ss-brand" onClick={goHome} aria-label="Discovery Lab home">
            <span className="ss-brand-icon"><Glyph name="sparkles" size={22} /></span>
            <span>Skill<span>Shadow</span><small>DISCOVERY LAB</small></span>
          </button>
          <div className="ss-top-right"><span className="ss-online" /><span>Discovery experience · Beta</span></div>
        </header>

        {error && <div role="alert" className="ss-error"><span>{error}</span><button type="button" onClick={() => { setError(''); if (screen === 'home') void loadCategories() }}> {screen === 'home' ? 'Retry' : 'Dismiss'} </button></div>}

        {screen === 'home' && (
          <main>
            <section className="ss-hero">
              <div className="ss-hero-copy">
                <span className="ss-eyebrow"><span className="ss-eyebrow-dot" /> YOUR POTENTIAL, EXPLORED</span>
                <h1>Discover what<br />you're <em>capable of.</em></h1>
                <p>Small, thoughtful challenges to help you explore how you think. See your strengths, understand your answers, and take the next step on your career journey.</p>
                <button className="ss-primary" type="button" onClick={() => void startAssessment('logical_reasoning')} disabled={busy || loading || !categories.some(c => c.id === 'logical_reasoning' && c.available)}>
                  {busy ? 'Preparing assessment…' : 'Start exploring'} <Glyph name="arrow" size={18} />
                </button>
                <div className="ss-hero-meta"><span><Glyph name="clock" size={16} /> ~5 minutes</span><span><Glyph name="shield" size={16} /> Practice, not a diagnosis</span></div>
              </div>
              <div className="ss-hero-art" aria-hidden="true">
                <div className="ss-orbit ss-orbit-outer"/><div className="ss-orbit ss-orbit-mid"/><div className="ss-orbit ss-orbit-inner"/>
                <div className="ss-art-core"><Glyph name="brain" size={62} /></div>
                <span className="ss-spark ss-spark-1">✦</span><span className="ss-spark ss-spark-2">✧</span><span className="ss-spark ss-spark-3">✦</span>
                <div className="ss-floating ss-floating-one"><span className="ss-float-dot cyan"/> Thinking patterns</div>
                <div className="ss-floating ss-floating-two"><span className="ss-float-dot purple"/> Hidden strengths</div>
              </div>
            </section>

            <section className="ss-section" aria-labelledby="assessments-heading">
              <div className="ss-section-heading"><div><div className="ss-overline">CHOOSE YOUR CHALLENGE</div><h2 id="assessments-heading">Explore your skill areas<span className="ss-asterisk">✳</span></h2><p>Choose an assessment. More skill areas are being developed.</p></div><span className="ss-section-count">06 skill areas</span></div>
              {loading ? <div className="ss-state">Loading assessments…</div> : categories.length === 0 ? <div className="ss-state">No assessments loaded. Start the API and retry.</div> : (
                <div className="ss-card-grid">
                  {categories.map((category, index) => (
                    <button key={category.id} className={`ss-skill-card ss-${category.accent} ${!category.available ? 'ss-disabled' : ''}`} type="button" disabled={!category.available || busy} onClick={() => void startAssessment(category.id)}>
                      <div className="ss-card-top"><span className="ss-card-glyph"><Glyph name={category.icon} size={26}/></span><span className={`ss-card-status ${category.available ? 'ss-ready' : ''}`}>{category.available ? 'AVAILABLE' : 'COMING SOON'}</span></div>
                      <div className="ss-card-no">0{index + 1}</div><h3>{category.name}</h3><p>{category.description}</p>
                      <div className="ss-card-bottom"><span>{category.available ? `${category.question_count} questions` : 'In development'}</span><Glyph name="arrow" size={18}/></div>
                    </button>
                  ))}
                </div>
              )}
            </section>

<section className="ss-section" aria-label="Career-specific assessments">
  <div className="ss-section-heading">
    <div>
      <div className="ss-overline">
        ASSESS THE SKILLS YOU'RE LEARNING
      </div>
      <h2>Career-specific assessments</h2>
      <p>
        Take practice tests in Python, SQL, UPSC
        subjects, or medical foundations.
        Choose a career and subject to begin.
      </p>
    </div>
  </div>

  <a
    className="ss-primary"
    href="/career-assessment.html"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      textDecoration: 'none'
    }}
  >
    Explore career tests
    <Glyph name="arrow" size={17}/>
  </a>
</section>

            <section className="ss-how"><div className="ss-how-intro"><div className="ss-overline">HOW IT WORKS</div><h2>Understand your<br/><em>thinking style.</em></h2></div><div className="ss-feature-grid">{featureCards.map(feature => <div className="ss-feature" key={feature.title}><div className="ss-feature-icon"><Glyph name={feature.icon} size={20}/></div><h3>{feature.title}</h3><p>{feature.desc}</p></div>)}</div></section>
            <footer className="ss-footer">Built for exploration, not formal skill certification. Future career matches will incorporate interests, education and occupational data.</footer>
          </main>
        )}

        {screen === 'quiz' && question && (
          <main className="ss-quiz-page">
            <button type="button" className="ss-back" onClick={goHome}><Glyph name="chevron" size={17}/> All assessments</button>
            <div className="ss-quiz-layout"><section className="ss-quiz-main"><div className="ss-quiz-head"><div><span className="ss-overline">DISCOVERY ASSESSMENT</span><h1>{selectedCategory?.name ?? 'Assessment'}</h1><p>Focus on each question. Take your time.</p></div><span className="ss-quiz-id">01 / 06</span></div>
              <div className="ss-progress-top"><span>YOUR PROGRESS</span><span>{answered} of {questions.length} answered</span></div>
              <div className="ss-progress-track"><div style={{ width: `${progress}%` }}/></div>
              <div className="ss-question-card"><div className="ss-question-top"><span className="ss-question-label">QUESTION {String(step+1).padStart(2,'0')}</span><span className="ss-type-label">MULTIPLE CHOICE</span></div><h2>{question.question}</h2><fieldset className="ss-options"><legend className="ss-sr-only">Choose one answer</legend>{question.options.map((option, index) => <label key={index} className={`ss-option ${answers[question.id] === index ? 'ss-option-selected' : ''}`}><input type="radio" name={`question-${question.id}`} value={index} checked={answers[question.id] === index} onChange={() => setAnswers(old => ({ ...old, [question.id]: index }))}/><span className="ss-option-letter">{String.fromCharCode(65+index)}</span><span>{option}</span><span className="ss-option-check"><Glyph name="check" size={15}/></span></label>)}</fieldset></div>
              <div className="ss-navigation"><button className="ss-secondary" type="button" disabled={step === 0 || busy} onClick={() => setStep(s => s-1)}><Glyph name="chevron" size={16}/> Previous</button>{step < questions.length-1 ? <button className="ss-primary" type="button" disabled={answers[question.id] === undefined || busy} onClick={() => setStep(s => s+1)}>Next question <Glyph name="arrow" size={17}/></button> : <button className="ss-primary" type="button" disabled={answered !== questions.length || busy} onClick={() => void submit()}>{busy ? 'Scoring…' : 'Finish assessment'} <Glyph name="arrow" size={17}/></button>}</div>
              <div className="ss-step-dots" aria-label="Question navigation">{questions.map((q,i) => <button key={q.id} type="button" className={`${i === step ? 'ss-step-current' : ''} ${answers[q.id] !== undefined ? 'ss-step-done' : ''}`} aria-label={`Go to question ${i+1}${answers[q.id] !== undefined ? ', answered' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>{i+1}</button>)}</div>
            </section><aside className="ss-quiz-sidebar"><div className="ss-aside-glyph"><Glyph name="brain" size={28}/></div><h3>Think it through.</h3><p>No rush, no pressure. The goal is to understand how you approach different kinds of problems.</p><div className="ss-aside-rule"/><div className="ss-aside-tip"><Glyph name="book" size={19}/><div><strong>Helpful tip</strong><span>Read every option before choosing your answer.</span></div></div><div className="ss-aside-rule"/><span className="ss-aside-note">Your explanations will be available after submission.</span></aside></div>
          </main>
        )}

        {screen === 'results' && result && (
          <main className="ss-results-page"><button className="ss-back" type="button" onClick={goHome}><Glyph name="chevron" size={17}/> Discovery Lab</button>
            <div className="ss-results-hero"><div><span className="ss-eyebrow"><span className="ss-eyebrow-dot"/> CHALLENGE COMPLETE</span><h1>Your results are in<span className="ss-asterisk">✳</span></h1><p>Nice work completing {selectedCategory?.name ?? 'the assessment'}. Explore the feedback below to understand what each question tested.</p><div className="ss-results-metrics"><div><strong>{result.correct} / {result.total}</strong><span>Correct answers</span></div><div><strong>{result.total - result.correct}</strong><span>To revisit</span></div></div></div><div className="ss-score-disc" style={{ '--score': `${result.score_percent}%` } as CSSProperties}><div><strong>{result.score_percent}<small>%</small></strong><span>PRACTICE SCORE</span></div></div></div>
            <div className="ss-review-heading"><div><span className="ss-overline">LOOK BACK & LEARN</span><h2>Question-by-question review</h2></div><span>{result.review.length} questions</span></div>
            <div className="ss-review-list">{result.review.map((entry, index) => <article className="ss-review-card" key={entry.question_id}><div className="ss-review-icon" data-correct={entry.is_correct}><Glyph name={entry.is_correct ? 'check' : 'x'} size={18}/></div><div><div className="ss-review-meta">QUESTION {String(index+1).padStart(2,'0')} · {entry.is_correct ? 'CORRECT' : 'NEEDS REVIEW'}</div><h3>{entry.question}</h3><p><strong>Correct answer:</strong> {entry.correct_answer}</p><p className="ss-explanation">{entry.explanation}</p></div></article>)}</div>
            <div className="ss-next-card"><div className="ss-next-icon"><Glyph name="sparkles" size={25}/></div><div><h3>What's next for SkillShadow?</h3><p>Your career recommendation integration is the next development phase. Assessments alone do not determine career suitability; we'll combine future results with your skills, interests, education and O*NET occupation data.</p><small>{result.disclaimer}</small></div></div>
            <div className="ss-result-actions"><button type="button" className="ss-secondary" onClick={() => void startAssessment(categoryId)} disabled={busy}><Glyph name="rotate" size={16}/> Try again</button><button type="button" className="ss-primary" onClick={goHome}>Explore Discovery Lab <Glyph name="arrow" size={17}/></button></div>
          </main>
        )}
      </div>
    </div>
  )
}

function errorText(error: unknown) { return error instanceof Error ? error.message : 'An unexpected error occurred.' }
