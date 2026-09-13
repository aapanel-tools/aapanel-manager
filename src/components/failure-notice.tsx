'use client';

import {cn} from '@/lib/utils';
import {useActionError} from '@/components/use-action-error';

export interface FailureNoticeProps {
  /** What could not be done, in this section's own words: "Could not load the tasks". */
  title: string;
  /**
   * What the action answered: a refusal code such as `unauthenticated`, or a
   * sentence presentError() has already made. Either is fine — this component
   * puts the first into words and leaves the second as it is.
   */
  message: string;
  className?: string;
}

/**
 * The block a section shows when something it asked for did not come back.
 *
 * One component rather than the same eleven lines of markup in every table and
 * card, and the reason is not tidiness. Each copy printed the action's message
 * as it arrived, so a session that expired while a page was open showed the
 * word `unauthenticated` in the middle of a Russian screen — in every copy at
 * once, and in every new section that copied the block from the last one
 * (Д-26). Here the message is translated in the one place it is drawn, and a
 * section cannot show it untranslated without writing its own markup.
 */
export function FailureNotice({title, message, className}: FailureNoticeProps) {
  const actionError = useActionError();
  return (
    <div
      className={cn(
        'rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive',
        className,
      )}
      role="alert"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs opacity-80">{actionError(message)}</p>
    </div>
  );
}
