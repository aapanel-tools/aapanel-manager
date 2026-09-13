'use client';

import {RouteError, type RouteErrorProps} from '@/components/route-error';

/**
 * Signing in, and a failure in the app's own layout, which the boundary inside
 * that layout cannot catch (ADR-0010). Renders inside the root layout, so the
 * reader's language is still known.
 */
export default function RootSegmentError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
