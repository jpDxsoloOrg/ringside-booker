/**
 * The Titles screen's place in the URL: `?tab=world` for Around the world (Our titles when left
 * out) and `?status=retired` for retired titles (active ones when left out), so Back and a title
 * page's back link return to the same view.
 */

/** The names of the Titles screen's search parameters. */
export const TITLES_PARAMS = { tab: 'tab', status: 'status' } as const;

export const TITLES_TABS = ['own', 'world'] as const;
export type TitlesTab = (typeof TITLES_TABS)[number];

export const TITLES_STATUSES = ['active', 'retired'] as const;
export type TitlesStatus = (typeof TITLES_STATUSES)[number];

/** What each tab is called in the URL; Our titles is the default and needs no parameter. */
const TAB_IN_URL: Readonly<Record<TitlesTab, string | null>> = { own: null, world: 'world' };
const STATUS_IN_URL: Readonly<Record<TitlesStatus, string | null>> = {
  active: null,
  retired: 'retired',
};

export interface TitlesView {
  readonly tab: TitlesTab;
  readonly status: TitlesStatus;
}

/** The view a URL asks for; anything unknown falls back to Our titles, active. */
export function titlesViewFromSearch(search: URLSearchParams): TitlesView {
  return {
    tab: search.get(TITLES_PARAMS.tab) === TAB_IN_URL.world ? 'world' : 'own',
    status: search.get(TITLES_PARAMS.status) === STATUS_IN_URL.retired ? 'retired' : 'active',
  };
}

/** `search` with the view's parameters set (or removed for the defaults); other params are kept. */
export function searchWithTitlesView(search: URLSearchParams, view: TitlesView): URLSearchParams {
  const next = new URLSearchParams(search);
  const tab = TAB_IN_URL[view.tab];
  const status = STATUS_IN_URL[view.status];
  if (tab === null) next.delete(TITLES_PARAMS.tab);
  else next.set(TITLES_PARAMS.tab, tab);
  if (status === null) next.delete(TITLES_PARAMS.status);
  else next.set(TITLES_PARAMS.status, status);
  return next;
}

export function isTitlesTab(value: string): value is TitlesTab {
  return TITLES_TABS.some((tab) => tab === value);
}

export function isTitlesStatus(value: string): value is TitlesStatus {
  return TITLES_STATUSES.some((status) => status === value);
}
