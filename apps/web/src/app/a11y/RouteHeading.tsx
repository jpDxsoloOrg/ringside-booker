import type { ReactNode } from 'react';

export interface RouteHeadingProps {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * A screen's page heading: the one `h1`, focusable from script (`tabIndex={-1}`) and marked with
 * `data-route-heading`, so `RouteFocus` can move focus to it after a navigation.
 */
export function RouteHeading({ className, children }: RouteHeadingProps) {
  return (
    <h1 className={className} tabIndex={-1} data-route-heading="">
      {children}
    </h1>
  );
}
