import { useEffect, useState } from 'react';

interface LiveRegionProps {
  message: string;
  politeness?: 'polite' | 'assertive';
  testId?: string;
}

export function LiveRegion({
  message,
  politeness = 'polite',
  testId = 'live-region',
}: LiveRegionProps) {
  const [announced, setAnnounced] = useState('');

  useEffect(() => {
    if (message.length === 0) {
      setAnnounced('');
      return;
    }
    setAnnounced('');
    const frame = requestAnimationFrame(() => {
      setAnnounced(message);
    });
    return () => cancelAnimationFrame(frame);
  }, [message, testId]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
      data-testid={testId}
    >
      {announced}
    </div>
  );
}
