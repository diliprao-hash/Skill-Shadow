
import { useEffect, useRef, useState } from "react";

type Props = {
  onComplete?: () => void;
  mobileOnly?: boolean;
  playOncePerSession?: boolean;
};

export default function SkillShadowIntro({
  onComplete,
  mobileOnly = false,
  playOncePerSession = true,
}: Props) {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;

    if (mobileOnly && window.innerWidth > 768) {
      return false;
    }

    try {
      if (
        playOncePerSession &&
        sessionStorage.getItem("skillshadow-video-played") === "yes"
      ) {
        return false;
      }
    } catch {
      // Continue if storage is unavailable.
    }

    return true;
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);

  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;

  const videoSource = isMobile
    ? "/videos/skillshadow-intro-mobile.mp4"
    : "/videos/skillshadow-intro.mp4";

  const finish = () => {
    if (finished.current) return;
    finished.current = true;

    if (playOncePerSession) {
      try {
        sessionStorage.setItem("skillshadow-video-played", "yes");
      } catch {
        // Storage may be unavailable.
      }
    }

    setVisible(false);
    onComplete?.();
  };

  useEffect(() => {
    if (!visible) return;

    const video = videoRef.current;

    if (video) {
      video.muted = true;
      video.play().catch(() => finish());
    }

    const timeout = window.setTimeout(() => {
      finish();
    }, 20000);

    return () => window.clearTimeout(timeout);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100dvh",
        zIndex: 99999,
        background: "black",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        src={videoSource}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}
