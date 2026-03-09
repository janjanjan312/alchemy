import React, { useMemo } from 'react';

export default function Stars() {
  const stars = useMemo(() => {
    return Array.from({ length: 200 }).map((_, i) => ({
      id: i,
      top: `${Math.random() * 200}%`, // Start some stars below the viewport
      left: `${Math.random() * 100}%`,
      size: Math.random() * 1.5 + 0.5,
      duration: `${Math.random() * 3 + 2}s`,
      driftDuration: `${Math.random() * 60 + 40}s`, // Slow drift
      delay: `${Math.random() * 10}s`,
    }));
  }, []);

  return (
    <div className="stars-container">
      {stars.map((star) => (
        <div
          key={star.id}
          className="star"
          style={{
            top: star.top,
            left: star.left,
            width: `${star.size}px`,
            height: `${star.size}px`,
            '--duration': star.duration,
            '--drift-duration': star.driftDuration,
            animationDelay: star.delay,
          } as React.CSSProperties}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-alchemy-black/20 to-alchemy-black" />
    </div>
  );
}
