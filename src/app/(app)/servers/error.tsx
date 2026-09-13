'use client';

import {RouteError, type RouteErrorProps} from '@/components/route-error';

/** The server list. The same fallback as every section, placed here so it stays the closest (ADR-0010). */
export default function ServersError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
