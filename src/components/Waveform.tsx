import { useEffect, useState, type CSSProperties } from 'react';
import { services } from '@/services';

const BAR_COUNT = 24;

/**
 * Synthetic per-bar animation timings, matching the prototype. Used whenever the
 * audio service does not publish a real level meter.
 */
const SYNTHETIC = Array.from({ length: BAR_COUNT }, (_, i) => ({
  dur: `${(0.6 + (i % 5) * 0.12).toFixed(2)}s`,
  delay: `${(i * 0.05).toFixed(2)}s`,
}));

export function Waveform({ active }: { active: boolean }) {
  const [levels, setLevels] = useState<number[] | null>(null);

  useEffect(() => {
    if (!active) {
      setLevels(null);
      return;
    }
    return services.audio.onLevels((next) => setLevels(next));
  }, [active]);

  return (
    <div className="wave" aria-hidden="true">
      {SYNTHETIC.map((bar, index) => {
        if (levels) {
          // Clamped so a hot signal can't push a bar past its container.
          const level = Math.min(1, Math.max(0.08, levels[index] ?? 0));
          return (
            <div
              key={index}
              className="wave-bar wave-bar--live"
              style={{ '--level': String(level) } as CSSProperties}
            />
          );
        }
        return (
          <div
            key={index}
            className="wave-bar"
            style={{ '--dur': bar.dur, '--delay': bar.delay } as CSSProperties}
          />
        );
      })}
    </div>
  );
}
