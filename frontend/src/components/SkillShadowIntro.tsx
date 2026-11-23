import { useEffect, useRef, useState } from "react";
import "./SkillShadowIntro.css";

export type SkillShadowIntroProps = {
  /** Called after the intro ends, or immediately when the intro is skipped by its settings. */
  onComplete?: () => void;
  /** Default: show on mobile widths (up to 768px) only. */
  mobileOnly?: boolean;
  /** Default: play once per browser tab/session. Disable while testing. */
  playOncePerSession?: boolean;
};

const STORAGE_KEY = "skillshadow-fast-intro-v2";
const INTRO_DURATION_MS = 3250; // matches the exit animation in CSS

/** Lightweight mobile intro: CSS transforms + opacity, no frame-by-frame React updates. */
export default function SkillShadowIntro({
  onComplete,
  mobileOnly = true,
  playOncePerSession = true,
}: SkillShadowIntroProps) {
  const [visible, setVisible] = useState(false);
  const done = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const complete = () => {
      if (done.current) return;
      done.current = true;
      onCompleteRef.current?.();
    };

    const shouldShowOnDevice = !mobileOnly || window.matchMedia("(max-width: 768px)").matches;
    let alreadyPlayed = false;
    if (playOncePerSession) {
      try {
        alreadyPlayed = window.sessionStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        // Private browsing may restrict storage; animation still works.
      }
    }

    if (!shouldShowOnDevice || alreadyPlayed) {
      complete();
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setVisible(true);

    const timer = window.setTimeout(() => {
      if (playOncePerSession) {
        try {
          window.sessionStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // Ignore unavailable browser storage.
        }
      }
      document.body.style.overflow = previousOverflow;
      setVisible(false);
      complete();
    }, reduceMotion ? 800 : INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOnly, playOncePerSession]);

  if (!visible) return null;

  return (
    <div className="ss-fi" role="status" aria-label="Opening SkillShadow">
      <div className="ss-fi__ambient" aria-hidden="true" />
      <div className="ss-fi__mesh" aria-hidden="true" />
      <div className="ss-fi__flash" aria-hidden="true" />

      <div className="ss-fi__top" aria-hidden="true">
        <span className="ss-fi__micro-mark">S<span>✦</span>S</span>
        <span>THE FUTURE IS YOURS</span>
      </div>

      <main className="ss-fi__main">
        <div className="ss-fi__emblem" aria-hidden="true">
          <div className="ss-fi__ring ss-fi__ring--one" />
          <div className="ss-fi__ring ss-fi__ring--two" />
          <div className="ss-fi__mark-glow" />
          <svg className="ss-fi__mark" viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M60 6 111 42 60 134 9 42 60 6Z" stroke="currentColor" strokeWidth="3" />
            <path d="M9 42 60 68 111 42M60 68V134M29 43 60 19 91 43 60 68 29 43Z" stroke="currentColor" strokeWidth="2" />
            <path d="M60 19V68" stroke="currentColor" strokeWidth="2" opacity=".55" />
          </svg>
          <span className="ss-fi__orbit-star ss-fi__orbit-star--one" />
          <span className="ss-fi__orbit-star ss-fi__orbit-star--two" />
        </div>

        <div className="ss-fi__copy">
          <div className="ss-fi__message ss-fi__message--first" aria-hidden="true">
            <p className="ss-fi__overline">YOU HAVE MORE IN YOU</p>
            <h1>FIND YOUR <span>EDGE.</span></h1>
          </div>
          <div className="ss-fi__message ss-fi__message--brand">
            <p className="ss-fi__overline">INTRODUCING</p>
            <h1>Skill<span>Shadow</span><i>.</i></h1>
            <p className="ss-fi__tagline">DISCOVER YOUR SKILLS. UNLOCK YOUR FUTURE.</p>
          </div>
        </div>
      </main>

      <div className="ss-fi__bottom" aria-hidden="true">
        <span>DISCOVER <b>✦</b> EVOLVE <b>✦</b> ACHIEVE</span>
      </div>
    </div>
  );
}
