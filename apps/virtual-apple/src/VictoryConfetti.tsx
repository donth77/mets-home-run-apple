import confetti from "canvas-confetti";
import { useEffect, useRef } from "react";

export function VictoryConfetti({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || reducedMotion || !canvas.current) return;
    const fire = confetti.create(canvas.current, {
      disableForReducedMotion: true,
      resize: true,
      useWorker: true,
    });
    const colors = ["#f36b2b", "#0b4f91", "#ffffff", "#f3bf45"];
    const timers: number[] = [];

    fire({
      colors,
      decay: 0.91,
      gravity: 0.88,
      origin: { x: 0.5, y: 0.36 },
      particleCount: 145,
      scalar: 0.95,
      shapes: ["square", "circle", "star"],
      spread: 98,
      startVelocity: 54,
      ticks: 260,
    });

    const sideCannons = () => {
      fire({
        colors,
        angle: 62,
        origin: { x: 0.04, y: 0.72 },
        particleCount: 54,
        scalar: 0.85,
        spread: 48,
        startVelocity: 58,
        ticks: 250,
      });
      fire({
        colors,
        angle: 118,
        origin: { x: 0.96, y: 0.72 },
        particleCount: 54,
        scalar: 0.85,
        spread: 48,
        startVelocity: 58,
        ticks: 250,
      });
    };
    timers.push(window.setTimeout(sideCannons, 260));
    timers.push(
      window.setTimeout(
        () =>
          fire({
            colors,
            decay: 0.92,
            gravity: 0.72,
            origin: { x: 0.5, y: 0.2 },
            particleCount: 72,
            scalar: 0.72,
            spread: 150,
            startVelocity: 28,
            ticks: 310,
          }),
        1050,
      ),
    );
    timers.push(window.setTimeout(sideCannons, 1750));

    return () => {
      timers.forEach(window.clearTimeout);
      fire.reset();
    };
  }, [active, reducedMotion]);

  if (!active || reducedMotion) return null;

  return (
    <div className="victory-confetti" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
