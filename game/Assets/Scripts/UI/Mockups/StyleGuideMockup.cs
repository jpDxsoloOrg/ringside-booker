using System.Linq;
using RingsideBooker.UI.Design;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>The style guide as a page: colours, states, type, spacing, radii, elevation and the icon set.</summary>
    public static class StyleGuideMockup
    {
        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            page.Add(Ds.Text("STYLE GUIDE", "ds-type-headline"));
            page.Add(Ds.Text("Tokens live in Assets/UI/Design/DsTokens.uss and are documented in game/docs/design-system.md.", "ds-type-caption", "mk-gap-bottom"));

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement left = Ds.Column("mk-grow");
            VisualElement right = Ds.Column("mk-grow");
            columns.Add(left);
            columns.Add(right);
            page.Add(columns);

            VisualElement colours = Ds.Panel("Colour");
            colours.Add(Swatches("Surfaces (elevation 0–4)", ("elev-0", "#080c15"), ("elev-1", "#0e1628"), ("elev-2", "#131d33"), ("elev-3", "#19253f"), ("elev-4", "#1f2d4b"), ("line", "#22314b"), ("line-strong", "#34476a")));
            colours.Add(Swatches("Text", ("text", "#f1f5f9"), ("text-2", "#b6c2d4"), ("text-3", "#7d8ca3"), ("text-4", "#56657d")));
            colours.Add(Swatches("Accents (one job each)", ("action", "#d7301a"), ("action-hover", "#ff3b1d"), ("data", "#00e5ff"), ("gold", "#facc15"), ("face", "#60a5fa"), ("heel", "#a78bfa")));
            colours.Add(Swatches("States", ("good", "#34d399"), ("warn", "#fbbf24"), ("bad", "#fb7185"), ("info", "#38bdf8"), ("neutral", "#94a3b8"), ("live", "#ff3b1d")));
            left.Add(colours);

            VisualElement states = Ds.Panel("States: colour, icon and a word");
            VisualElement pills = Ds.Row("ds-row--wrap", "mk-wrap-gap");
            pills.Add(Ds.Pill(DsState.Good, "Ready"));
            pills.Add(Ds.Pill(DsState.Warn, "Banged up"));
            pills.Add(Ds.Pill(DsState.Bad, "Injured", "injured"));
            pills.Add(Ds.Pill(DsState.Info, "New"));
            pills.Add(Ds.Pill(DsState.Neutral, "Steady"));
            pills.Add(Ds.Pill(DsState.Live, "Live", "live", solid: true));
            pills.Add(Ds.Pill(DsState.Gold, "Champion", "crown"));
            states.Add(pills);
            VisualElement dots = Ds.Row("ds-row--wrap", "mk-wrap-gap");
            dots.Add(Ds.Dot(DsState.Good, "Happy"));
            dots.Add(Ds.Dot(DsState.Neutral, "Content"));
            dots.Add(Ds.Dot(DsState.Warn, "Unhappy"));
            dots.Add(Ds.Dot(DsState.Bad, "Wants out"));
            states.Add(dots);
            left.Add(states);

            VisualElement type = Ds.Panel("Type scale (1080p)");
            type.Add(TypeRow("Display 44", "SHOW NIGHT", "ds-type-display"));
            type.Add(TypeRow("Headline 28", "ALTURA SHOWCASE", "ds-type-headline"));
            type.Add(TypeRow("Title 20", "MAIN EVENT", "ds-type-title"));
            type.Add(TypeRow("Subtitle 16", "Calder Voss vs Ewan Thackeray", "ds-type-subtitle"));
            type.Add(TypeRow("Body 14", "Plain words first, numbers second.", "ds-type-body"));
            type.Add(TypeRow("Caption 12", "Brackwater Arena · Sun 31 Jan 2027", "ds-type-caption"));
            type.Add(TypeRow("Micro 11", "SECTION LABEL", "ds-type-micro"));
            left.Add(type);

            VisualElement space = Ds.Panel("Spacing, radii, elevation");
            VisualElement steps = Ds.Row("ds-row--top", "mk-wrap-gap");
            foreach (int step in new[] { 2, 4, 8, 12, 16, 20, 24, 32, 48 })
            {
                VisualElement cell = Ds.Column("mk-space");
                VisualElement block = Ds.El("mk-space__block");
                block.style.width = step;
                block.style.height = step;
                cell.Add(block);
                cell.Add(Ds.Text($"{step}", "ds-type-caption"));
                steps.Add(cell);
            }
            space.Add(steps);
            VisualElement radii = Ds.Row("mk-wrap-gap");
            foreach ((string name, int radius) in new[] { ("xs", 2), ("sm", 4), ("md", 6), ("lg", 10), ("pill", 999) })
            {
                VisualElement cell = Ds.Column("mk-space");
                VisualElement block = Ds.El("mk-radius");
                block.style.borderTopLeftRadius = radius;
                block.style.borderTopRightRadius = radius;
                block.style.borderBottomLeftRadius = radius;
                block.style.borderBottomRightRadius = radius;
                cell.Add(block);
                cell.Add(Ds.Text(name, "ds-type-caption"));
                radii.Add(cell);
            }
            space.Add(radii);
            VisualElement elevation = Ds.Row("mk-wrap-gap");
            for (int level = 0; level <= 4; level++)
            {
                VisualElement block = Ds.El("mk-elev", $"mk-elev--{level}");
                block.Add(Ds.Text($"{level}", "ds-type-title"));
                elevation.Add(block);
            }
            space.Add(elevation);
            space.Add(Ds.Text("Motion: 120 ms hover and press · 180 ms expand and tabs · 300 ms sheets and reveals · ease-out.", "ds-type-caption", "mk-gap-top"));
            right.Add(space);

            VisualElement icons = Ds.Panel($"Icons ({IconLibrary.Names.Count}, Lucide, ISC)");
            VisualElement grid = Ds.Row("ds-row--wrap", "mk-icon-grid");
            foreach (string name in IconLibrary.Names)
            {
                VisualElement cell = Ds.Column("mk-icon-cell");
                cell.Add(new Icon(name, "ds-icon--lg"));
                cell.Add(Ds.Text(name, "mk-icon-cell__name"));
                grid.Add(cell);
            }
            icons.Add(grid);
            right.Add(icons);
            return page;
        }

        private static VisualElement Swatches(string title, params (string name, string hex)[] colours)
        {
            VisualElement block = Ds.Column("mk-swatch-group");
            block.Add(Ds.Text(title.ToUpperInvariant(), "mk-label"));
            VisualElement row = Ds.Row("ds-row--wrap");
            foreach ((string name, string hex) in colours)
            {
                VisualElement cell = Ds.Column("mk-swatch");
                VisualElement chip = Ds.El("mk-swatch__chip");
                if (ColorUtility.TryParseHtmlString(hex, out Color color)) chip.style.backgroundColor = color;
                cell.Add(chip);
                cell.Add(Ds.Text(name, "mk-swatch__name"));
                cell.Add(Ds.Text(hex, "mk-swatch__hex"));
                row.Add(cell);
            }
            block.Add(row);
            return block;
        }

        private static VisualElement TypeRow(string label, string sample, string className)
        {
            VisualElement row = Ds.Row("mk-type-row");
            row.Add(Ds.Text(label, "mk-type-row__label"));
            row.Add(Ds.Text(sample, className));
            return row;
        }
    }

    /// <summary>The component gallery: every builder in the design system, in its states.</summary>
    public static class ComponentsMockup
    {
        public static Button ModalButton { get; private set; }
        public static VisualElement WhyDemoHost { get; private set; }
        public static Button WhyDemoButton { get; private set; }

        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            page.Add(Ds.Text("COMPONENTS", "ds-type-headline"));
            page.Add(Ds.Text("The shared set every screen builds from (Scripts/UI/Design). Hover anything with a ? for its Why?.", "ds-type-caption", "mk-gap-bottom"));

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement left = Ds.Column("mk-grow");
            VisualElement right = Ds.Column("mk-grow");
            columns.Add(left);
            columns.Add(right);
            page.Add(columns);

            VisualElement buttons = Ds.Panel("Buttons");
            VisualElement row1 = Ds.Row("mk-wrap-gap");
            row1.Add(Ds.Cta("Next day", null, "next-day"));
            row1.Add(Ds.Button("Book the card", null, DsButtonKind.Primary, "booking"));
            row1.Add(Ds.Button("Auto-fill", null, DsButtonKind.Secondary, "sparkles"));
            row1.Add(Ds.Button("Clear", null, DsButtonKind.Ghost, "trash"));
            row1.Add(Ds.Button("Release", null, DsButtonKind.Danger, "user-minus"));
            buttons.Add(row1);
            VisualElement row2 = Ds.Row("mk-wrap-gap");
            row2.Add(Ds.IconButton("edit", "Edit", null));
            row2.Add(Ds.IconButton("more", "More", null));
            row2.Add(Ds.IconButton("fast-forward", "Skip days", null, quiet: false));
            Button disabled = Ds.Button("Disabled", null, DsButtonKind.Secondary);
            disabled.SetEnabled(false);
            row2.Add(disabled);
            buttons.Add(row2);
            left.Add(buttons);

            VisualElement chips = Ds.Panel("Chips, badges, tags");
            VisualElement chipRow = Ds.Row("mk-wrap-gap");
            chipRow.Add(Ds.Chip("All", true, null, 44));
            chipRow.Add(Ds.Chip("Main eventers", false, null, 5));
            chipRow.Add(Ds.Chip("Injured", false, null, 1, "injured"));
            chipRow.Add(Ds.Badge("3"));
            chipRow.Add(Ds.Badge("12", DsState.Info));
            chipRow.Add(Ds.Tag("Face", "face"));
            chipRow.Add(Ds.Tag("Heel", "heel"));
            chipRow.Add(Ds.Tag("Champion", "gold"));
            chipRow.Add(Ds.Tag("Live", "live"));
            chips.Add(chipRow);
            left.Add(chips);

            VisualElement tabs = Ds.Panel("Tabs");
            var underline = new DsTabs();
            underline.Add("all", "All", 44).Add("men", "Men", 31).Add("women", "Women", 13).Add("tag", "Tag teams", 6);
            tabs.Add(underline);
            var segmented = new DsTabs(segmented: true);
            segmented.Add("cards", "Cards", null, "users").Add("table", "Table", null, "columns");
            segmented.AddToClassList("mk-gap-top");
            tabs.Add(segmented);
            left.Add(tabs);

            VisualElement numbers = Ds.Panel("Stat tiles, meters, the quiet Why?");
            VisualElement tiles = Ds.Row("mk-tiles");
            VisualElement attendance = Ds.StatTile("Attendance", "14,212", "95% full", DsState.Good, "+6%", DsState.Good, MockupWhy.Attendance);
            attendance.AddToClassList("ds-why-host--hover");
            WhyDemoHost = attendance;
            WhyDemoButton = attendance.Q<Button>(className: "ds-why");
            tiles.Add(attendance);
            tiles.Add(Ds.StatTile("Morale", "Happy", "Most of the locker room", DsState.Good));
            tiles.Add(Ds.StatTile("Injuries", "1", "The Cheetah, 2 weeks", DsState.Bad, "+1", DsState.Bad));
            numbers.Add(tiles);
            numbers.Add(Ds.Meter(0.82f, DsState.Good, "Chemistry"));
            numbers.Add(Ds.Meter(0.48f, DsState.Warn, "Fatigue"));
            numbers.Add(Ds.Meter(0.25f, DsState.Bad, "Risk"));
            left.Add(numbers);

            VisualElement states = Ds.Panel("Empty, loading, skeleton");
            VisualElement stateRow = Ds.Row("ds-row--top");
            VisualElement empty = Ds.Empty("booking", "No matches booked yet", "Auto-fill books a sensible card you can change, or add matches one by one.", "Auto-fill", null, "sparkles");
            empty.AddToClassList("mk-grow");
            stateRow.Add(empty);
            VisualElement loading = Ds.Column("mk-grow");
            loading.Add(Ds.Loading("Simulating the show…"));
            loading.Add(Ds.Skeleton(80, "title"));
            loading.Add(Ds.Skeleton(95));
            loading.Add(Ds.Skeleton(70));
            loading.Add(Ds.Skeleton(85));
            stateRow.Add(loading);
            states.Add(stateRow);
            left.Add(states);

            VisualElement overlays = Ds.Panel("Overlays");
            VisualElement overlayRow = Ds.Row("mk-wrap-gap");
            overlayRow.Add(Ds.Button("Side sheet", () => RosterMockup.OpenWorker(mock, MockupData.Get("Sable Whitcombe")), DsButtonKind.Secondary, "layers"));
            ModalButton = Ds.Button("Modal", () => OpenModal(mock), DsButtonKind.Secondary, "info");
            overlayRow.Add(ModalButton);
            overlayRow.Add(Ds.Button("Toast", () => DsOverlay.Toast(mock.Shell.Root, "Card saved", DsState.Good, "Altura Showcase: 9 of 9 booked."), DsButtonKind.Secondary, "bell"));
            Button tip = Ds.Button("Tooltip", null, DsButtonKind.Secondary, "help");
            DsTooltip.Attach(tip, "Short help in plain words, after a moment's hover or on keyboard focus.", "Tooltip");
            overlayRow.Add(tip);
            overlays.Add(overlayRow);
            left.Add(overlays);

            VisualElement cards = Ds.Panel("Cards");
            cards.Add(DsCards.ShowCard(MockupData.MainstageTonight()));
            Matchup sample = MockupData.ShowcaseCard()[3];
            VisualElement match = DsCards.MatchupCard(sample);
            match.AddToClassList("mk-gap-top");
            cards.Add(match);
            VisualElement cardRow = Ds.Row("ds-row--top", "mk-gap-top");
            cardRow.Add(DsCards.PortraitCard(MockupData.Get("Calder Voss").ToCard()));
            cardRow.Add(DsCards.PortraitCard(MockupData.Get("Ewan Thackeray").ToCard()));
            VisualElement news = Ds.Column("mk-grow");
            foreach (NewsItem item in MockupData.Stories.Skip(1).Take(3)) news.Add(DsCards.NewsCard(item));
            cardRow.Add(news);
            cards.Add(cardRow);
            right.Add(cards);

            VisualElement broadcast = Ds.Panel("Scoreboard and ticker");
            broadcast.Add(DsCards.Scoreboard(new[]
            {
                ("Attendance", "14,212", "95% full", DsState.Good),
                ("Gate", "$1.21M", null, DsState.Neutral),
                ("Show", "4 ★", "Great show", DsState.Gold),
            }));
            VisualElement ticker = DsCards.Ticker("Latest", MockupData.Ticker, animate: !MockupShots.Running);
            ticker.AddToClassList("mk-gap-top");
            broadcast.Add(ticker);
            right.Add(broadcast);

            VisualElement table = Ds.Panel("Compact table (sort, column picker, expand)", null, null, "ds-panel");
            var demo = new DsTable<MockWorker>(new[]
            {
                new DsColumn<MockWorker>("name", "Name", w => Ds.Text(w.Name, "ds-cell__text", "ds-cell__text--strong")) { Grow = 2, Pinned = true, SortKey = w => w.Name },
                new DsColumn<MockWorker>("position", "Position", w => Ds.Text(w.Position, "ds-cell__text")) { SortKey = w => w.PushRank },
                new DsColumn<MockWorker>("morale", "Morale", w => Ds.Dot(w.MoraleState.state, w.MoraleState.word)) { SortKey = w => w.Morale },
                new DsColumn<MockWorker>("ring", "Ring work", w => Ds.Text(w.Ringwork.ToString(), "ds-cell__text", "ds-cell__text--num")) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = w => w.Ringwork },
            }, MockupData.Roster.Where(w => w.Push == "mainEvent"), w => Ds.Text($"{w.Name}: {w.StyleWord}, {w.Age}. Contract to {w.ContractEnds:MMM yyyy}.", "ds-type-body"));
            demo.SortBy("position", true);
            table.Add(demo);
            right.Add(table);
            return page;
        }

        public static void OpenModal(MockupController mock)
        {
            VisualElement body = Ds.Column();
            body.Add(Ds.Text("Ewan Thackeray wants a guaranteed rematch clause before he signs his extension.", "ds-type-body", "ds-wrap"));
            body.Add(Ds.KeyValues(("Asking", "$65,000 a month"), ("Current", "$60,000 a month"), ("Length", "2 years")));
            DsOverlay.Modal(mock.Shell.Root, "Contract talks", body,
                ("Not now", DsButtonKind.Ghost, null),
                ("Counter-offer", DsButtonKind.Secondary, null),
                ("Accept", DsButtonKind.Primary, () => DsOverlay.Toast(mock.Shell.Root, "Thackeray signed for two more years", DsState.Good)));
        }
    }
}
