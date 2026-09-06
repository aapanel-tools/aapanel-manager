'use client';
import {useEffect, useRef} from 'react';
import {useRouter} from 'next/navigation';

/** Subscribes to the SSE status stream and triggers a debounced RSC refresh.
 *  Renders nothing. EventSource auto-reconnects on transient errors. */
export function ServersLive() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/sse/servers');
    es.onmessage = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 1200); // coalesce bursts
    };
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
