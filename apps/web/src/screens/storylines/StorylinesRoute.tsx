import { lazy, Suspense } from 'react';

// The desk pulls in the cards, the editor sheet and the member picker: its own chunk (UI-21).
const StorylinesScreen = lazy(async () => {
  const { StorylinesScreen: Screen } = await import('./StorylinesScreen');
  return { default: Screen };
});

/**
 * Creative > Storylines as the navigation's screen: the real screen loads as its own chunk the
 * first time it opens. The detail page is lazy through the router (`gameDetailRoutes`).
 */
export function StorylinesRoute() {
  return (
    <Suspense fallback={null}>
      <StorylinesScreen />
    </Suspense>
  );
}
