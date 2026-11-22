import { useCallback, useEffect, useRef, useState } from "react";
import "./SkillShadowIntro.css";

const SESSION_KEY = "skillshadow_intro_watched_v2";

type SkillShadowIntroProps = {
  /** false = replay on refresh; true = play only once per tab session */
  playOncePerSession?: boolean;
  onComplete?: () => void;
};

function isPortraitPhone() {
  return typeof window !== "undefined" &&
    window.matchMedia("(orientation: portrait) and (max-width: 800px)").matches;
}

export default function SkillShadowIntro({
  playOncePerSession = true,
  onComplete,
}: SkillShadowIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);
  const [videoSrc] = useState(() =>
    isPortraitPhone()
      ? "/videos/skillshadow-intro-mobile.mp4"
      : "/videos/skillshadow-intro.mp4"
  );
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    try {
      return !playOncePerSession || sessionStorage.getItem(SESSION_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [exiting, setExiting] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (playOncePerSession) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* unavailable */ }
    }
    setExiting(true);
    window.setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 600);
  }, [onComplete, playOncePerSession]);

  const tryMutedAutoplay = useCallback(() => {
    const video = videoRef.current;
    if (!video || finishedRef.current) return;
    video.muted = true;
    video.defaultMuted = true;
    // Autoplay with audio cannot be guaranteed on phones.
    // Muted + playsInline works in normal Chrome/Safari mobile settings.
    void video.play().catch(() => {
      // A browser may still restrict playback (e.g. Low Power Mode).
      // The fallback timer will return the user to the homepage.
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    tryMutedAutoplay();
    // Do not leave visitors stuck on a blank intro if media cannot load.
    const fallback = window.setTimeout(finish, 22000);
    return () => {
      window.clearTimeout(fallback);
      document.body.style.overflow = previousOverflow;
    };
  }, [visible, finish, tryMutedAutoplay]);

  if (!visible) return null;

  return (
    <div className={`ss-intro ${exiting ? "ss-intro--exiting" : ""}`}
      role="region" aria-label="SkillShadow cinematic intro">
      <video
        ref={videoRef}
        className="ss-intro__video"
        src={videoSrc}
        autoPlay
        muted
        playsInline
        preload="auto"
        controls={false}
        onLoadedMetadata={tryMutedAutoplay}
        onCanPlay={tryMutedAutoplay}
        onEnded={finish}
        onError={finish}
      />
      <div className="ss-intro__vignette" aria-hidden="true" />
    </div>
  );
}
