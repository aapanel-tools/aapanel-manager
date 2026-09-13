'use client';

import {RouteError, type RouteErrorProps} from '@/components/route-error';

/**
 * A server's sections. Closest to them, inside the server's own layout, so a
 * failure in one section keeps the server header and the section links
 * (ADR-0010).
 */
export default function ServerSectionError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
