'use client';

import {RouteError, type RouteErrorProps} from '@/components/route-error';

/**
 * Every section of the app, below its navigation. Without it a failure on a
 * route with no boundary of its own — settings, users, jobs, the journal, the
 * summary — replaced the whole app with Next's error page (ADR-0010).
 */
export default function AppSectionError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
