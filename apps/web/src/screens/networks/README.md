# Business > Networks

`/game/networks`: the TV, streaming and pay-per-view deals of the promotion the local seat runs,
and the networks that would take its shows. The engine side (valuation, airings, deal health and
the deal commands) is in `docs/design/broadcast.md`; this folder only reads it.

| File                                          | What it does                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `NetworksScreen.tsx`                          | Heading, the no-promotion and no-game states, the tab strip, the two sheets  |
| `registry.ts`                                 | `registerNetworksTab`, `useNetworksTabs`, `networksTabs`                     |
| `builtinTabs.tsx`                             | Your deals (order 10) and Available networks (order 20)                      |
| `YourDealsTab.tsx`, `dealColumns.tsx`         | `broadcast.deals`: one row per deal, phone cards, "Show ended deals"         |
| `AvailableNetworksTab.tsx`                    | `broadcast.networks`: covering networks, what they carry, their best offer   |
| `DealSheet.tsx`, `DealDetailView.tsx`         | `broadcast.deal`: terms, health and reasons, airing history, the two actions |
| `RenegotiateView.tsx`                         | The renewal preview (`broadcast.valuation` with `dealId`) and Renew          |
| `CancelDealDialog.tsx`                        | `broadcast.cancelPreview` and `broadcast.cancelDeal`                         |
| `ProposeDealSheet.tsx`, `ProposalPreview.tsx` | The Propose sheet: show, timeslot, live, length, and the network's answer    |
| `components/DealHealthBadge.tsx`              | Safe, Watch, At risk, Cancelling or Missed airing, with reasons and a Why?   |
| `components/VerdictBadge.tsx`                 | Would accept / Would refuse with the first reason and a Why?                 |
| `components/DealTrend.tsx`                    | Viewers of the last airings against what the network expects, one scale      |
| `networkText.ts`                              | `formatSlot` ("Mon · Prime time · Live") and every label the screen uses     |
| `networksParams.ts`                           | The URL: `?tab=`, `?deal=`, `?propose=`; `networksPath()` for links          |
| `finances/BroadcastIncomeKpi.tsx`             | The Finances Overview's "TV income (30 days)" card (`eco.broadcast`, 50)     |

## The URL

`?tab=<registered tab id>` (`eco.yourDeals` by default, `eco.available`), `?deal=dea_…` opens the
deal sheet and `?propose=net_…` the Propose sheet. A tab change replaces the history entry;
opening a sheet pushes one, so Back closes it. Other screens link with
`networksPath({ tab, deal })`.

## Adding a tab

ECO10's "Your service" adds itself from its own folder, without editing the screen:

```tsx
registerNetworksTab({
  id: 'eco.yourService', // also the ?tab= value
  order: 30,
  label: 'Your service',
  render: ({ promotionId, openDeal, openPropose }) => <YourServiceTab promotionId={promotionId} />,
});
```

It returns a function that removes the tab again and throws for an id that is taken. `render`
only runs while the tab is selected, so it may run its own queries. The context also has
`openTab(id)`, `focusDealId` (a deal just signed) and `onDealFocused()`. Import the registering
module from `NetworksScreen.tsx` (one line) so it loads with the screen.

| Order | Tab                  |
| ----- | -------------------- |
| 10    | Your deals           |
| 20    | Available networks   |
| 30    | Your service (ECO10) |

## Money stays a challenge

Two of the owner's decisions are said on screen, not hidden:

- A deal whose airtime costs more than it pays loses money on every airing. The Propose sheet and
  the renewal say so in words (`LOSES_MONEY_TEXT`) next to "Income per airing" and its Why?; the
  Available networks row says "loses $X an airing"; the deal sheet says so when the last airing
  lost money, with that airing's Why?.
- New and renewed pay-per-view deals carry the high pay-per-view airtime rate. The Propose sheet
  and the renewal say what it comes to a show before you sign (`PPV_AIRTIME_TEXT`).

Deal warnings (`broadcast.dealWarned`) do not stop a skip: the risk badge is the notice. ECO8-07
turns them into mail.

## Why? everywhere

Last viewers (the airing's breakdown), what the network expects, every term in the Propose sheet
and the renewal, income per airing, the verdict, the health badge (the stored verdict, once there
is one), each airing's viewers and net, the exit fee and the Finances card all open their
breakdown. Rivals appear by name only: no rival money is on the screen.

## Phones

Both tables become DataTable cards (logo, name, slot, the stats, health and end date; the trend
is desktop only), the sheets come up from the bottom, the Propose form stacks, and the tab strip
scrolls inside itself. Nothing scrolls the page sideways at 390px.
