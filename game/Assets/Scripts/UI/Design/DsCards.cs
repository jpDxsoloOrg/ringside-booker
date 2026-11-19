using System;
using System.Collections.Generic;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    public enum Alignment
    {
        Face,
        Heel,
        Tweener,
    }

    /// <summary>What a portrait card shows about one worker. Words first; numbers are for the details.</summary>
    public sealed class WorkerCard
    {
        public string Id;
        public string Name;
        /// <summary>The card position in words: "Main eventer", "Upper card", "Midcard".</summary>
        public string Position;
        public Alignment Alignment;
        public string Style;
        public Texture2D Picture;
        /// <summary>Popularity 0–100 and its word ("Huge star", "Known", "Unknown").</summary>
        public int Popularity;
        public string PopularityWord;
        public DsState Morale;
        public string MoraleWord;
        public DsState Condition;
        public string ConditionWord;
        /// <summary>The title they hold, or null.</summary>
        public string Champion;
        public string Contract;
        public string Trend;
        public DsState TrendState;
    }

    public sealed class MatchupSide
    {
        public MatchupSide(string name, Alignment alignment, string note = null, string champion = null, Texture2D picture = null)
        {
            Name = name;
            Alignment = alignment;
            Note = note;
            Champion = champion;
            Picture = picture;
        }

        public string Name { get; }
        public Alignment Alignment { get; }
        /// <summary>One quiet line under the name ("Won last 3", "Debut").</summary>
        public string Note { get; }
        public string Champion { get; }
        public Texture2D Picture { get; }
        /// <summary>Team members, when the side is a team (shown as a second line).</summary>
        public string Members { get; set; }
    }

    public sealed class Matchup
    {
        public string Slot;
        public string MatchType;
        /// <summary>The title on the line, or null.</summary>
        public string Title;
        public MatchupSide A;
        public MatchupSide B;
        public string Length;
        /// <summary>Problems or notes shown as pills; empty when the match is fine (the quiet case).</summary>
        public List<(DsState state, string text)> Flags = new List<(DsState, string)>();
        /// <summary>Predicted or final rating in stars (0–5), or null.</summary>
        public float? Stars;
        /// <summary>0 = side A won, 1 = side B won, null = not decided (booking) or a draw.</summary>
        public int? Winner;
        public string Finish;
        /// <summary>A segment that isn't a match (promo, interview): side B is null.</summary>
        public bool IsSegment;
    }

    public sealed class ShowCardData
    {
        public string Name;
        public string Logo;
        public string LogoColor = "#2b6cb0";
        public string When;
        public string Venue;
        /// <summary>"Weekly TV", "Monthly special", "House show".</summary>
        public string Importance;
        public DsState ImportanceState = DsState.Info;
        public int Booked;
        public int Slots;
        public string Countdown;
    }

    public sealed class NewsItem
    {
        public string Kicker;
        public string Headline;
        public string Dek;
        public string When;
        public string Icon = "newspaper";
        public DsState State = DsState.Neutral;
    }

    /// <summary>Cards: portrait, matchup, show, news, scoreboard, ticker and the promotion logo plate.</summary>
    public static class DsCards
    {
        public static PortraitTone Tone(Alignment alignment) => alignment switch
        {
            Alignment.Face => PortraitTone.Face,
            Alignment.Heel => PortraitTone.Heel,
            _ => PortraitTone.Neutral,
        };

        /// <summary>
        /// A portrait in a rounded box (sizes: ds-portrait--xs/sm/md/lg/xl). Pass the worker's
        /// <paramref name="name"/> so a worker with no picture gets their initials (the default
        /// placeholder); without it the placeholder is the silhouette.
        /// </summary>
        public static VisualElement PortraitBox(Texture2D picture, Alignment alignment, string sizeClass, bool gold = false, string name = null)
        {
            VisualElement box = Ui.El("ds-portrait", sizeClass);
            box.Add(new Portrait(picture, gold ? PortraitTone.Gold : Tone(alignment), name));
            return box;
        }

        /// <summary>
        /// The roster's portrait card: big picture, name over a shaded foot, card position, and three
        /// state words (popularity, morale, condition). A champion gets a gold edge and a belt line.
        /// </summary>
        public static VisualElement PortraitCard(WorkerCard worker)
        {
            VisualElement card = Ui.El("ds-pcard");
            card.focusable = true;
            if (worker.Champion != null) card.AddToClassList("ds-pcard--champion");
            VisualElement art = Ui.El("ds-pcard__art");
            art.Add(new Portrait(worker.Picture, worker.Champion != null ? PortraitTone.Gold : Tone(worker.Alignment), worker.Name));
            VisualElement shade = new GradientFill(new Color(0.035f, 0.05f, 0.086f, 0f), new Color(0.035f, 0.05f, 0.086f, 0.95f));
            shade.AddToClassList("ds-pcard__shade");
            art.Add(shade);
            Label align = Ds.Tag(worker.Alignment.ToString(), worker.Alignment.ToString().ToLowerInvariant());
            align.AddToClassList("ds-pcard__align");
            art.Add(align);
            if (worker.Trend != null)
            {
                VisualElement trend = Ui.El("ds-trend", "ds-pcard__trend", Ds.StateClass(worker.TrendState));
                trend.Add(new Icon(worker.TrendState == DsState.Bad ? "trend-down" : "trend-up", "ds-icon--xs"));
                trend.Add(Ui.Text(worker.Trend, "ds-trend__text"));
                art.Add(trend);
            }
            VisualElement nameplate = Ui.El("ds-pcard__nameplate");
            if (worker.Champion != null)
            {
                VisualElement belt = Ui.El("ds-pcard__belt");
                belt.Add(new Icon("crown", "ds-icon--xs"));
                belt.Add(Ui.Text(TextFormat.Upper(worker.Champion), "ds-pcard__belt-text"));
                nameplate.Add(belt);
            }
            nameplate.Add(Ui.Text(TextFormat.Upper(worker.Name), "ds-pcard__name"));
            nameplate.Add(Ui.Text($"{worker.Position} · {worker.Style}", "ds-pcard__role"));
            art.Add(nameplate);
            card.Add(art);

            VisualElement facts = Ui.El("ds-pcard__facts");
            facts.Add(Fact("Popularity", worker.PopularityWord, PopularityState(worker.Popularity)));
            facts.Add(Fact("Morale", worker.MoraleWord, worker.Morale));
            facts.Add(Fact("Condition", worker.ConditionWord, worker.Condition));
            card.Add(facts);
            return card;
        }

        private static DsState PopularityState(int popularity) =>
            popularity >= 70 ? DsState.Gold : popularity >= 45 ? DsState.Info : DsState.Neutral;

        private static VisualElement Fact(string label, string word, DsState state)
        {
            VisualElement fact = Ui.El("ds-pcard__fact", Ds.StateClass(state));
            fact.Add(Ui.Text(TextFormat.Upper(label), "ds-pcard__fact-label"));
            fact.Add(Ds.Dot(state, word));
            return fact;
        }

        /// <summary>
        /// A matchup card: slot and match type on top, the title on the line in gold, both sides facing
        /// off across a skewed VS, and pills only when something needs a look. <paramref name="big"/> is
        /// the show-night size; results pass a <see cref="Matchup.Winner"/>.
        /// </summary>
        public static VisualElement MatchupCard(Matchup match, bool big = false, Action onClick = null)
        {
            VisualElement card = Ui.El("ds-match");
            if (big) card.AddToClassList("ds-match--big");
            if (match.Title != null) card.AddToClassList("ds-match--title");
            if (match.Flags.Count > 0) card.AddToClassList("ds-match--flagged");
            card.focusable = onClick != null;
            if (onClick != null) card.AddManipulator(new Clickable(onClick));

            VisualElement top = Ui.El("ds-match__top");
            top.Add(Ui.Text(TextFormat.Upper(match.Slot), "ds-match__slot"));
            top.Add(Ui.Text(match.MatchType, "ds-match__type"));
            top.Add(Ds.Spacer());
            if (match.Length != null)
            {
                top.Add(new Icon("clock", "ds-icon--xs", "ds-match__meta-icon"));
                top.Add(Ui.Text(match.Length, "ds-match__meta"));
            }
            if (match.Stars.HasValue)
            {
                var stars = new Stars(match.Stars.Value, big ? "ds-icon--md" : "ds-icon--sm");
                stars.AddToClassList("ds-match__stars");
                top.Add(stars);
            }
            card.Add(top);

            if (match.Title != null)
            {
                VisualElement title = Ui.El("ds-match__title");
                title.Add(new Icon("trophy", "ds-icon--xs"));
                title.Add(Ui.Text(TextFormat.Upper(match.Title), "ds-match__title-text"));
                card.Add(title);
            }

            VisualElement faceoff = Ui.El("ds-match__faceoff");
            faceoff.Add(Side(match.A, false, big, match.Winner == 0, match.Winner == 1));
            if (match.IsSegment || match.B == null)
            {
                faceoff.Add(Ui.El("ds-match__segment-gap"));
            }
            else
            {
                VisualElement vs = new SkewShape();
                vs.AddToClassList("ds-match__vs");
                vs.Add(Ui.Text(match.Winner.HasValue ? "DEF." : "VS", "ds-match__vs-text"));
                if (match.Winner == 1)
                {
                    // Keep the winner on the left in results: swap the visual order.
                    faceoff.Clear();
                    faceoff.Add(Side(match.B, false, big, true, false));
                    faceoff.Add(vs);
                    faceoff.Add(Side(match.A, true, big, false, true));
                }
                else
                {
                    faceoff.Add(vs);
                    faceoff.Add(Side(match.B, true, big, false, match.Winner == 0));
                }
            }
            card.Add(faceoff);

            // The foot only appears when there is something to say (a problem, a finish): quiet otherwise.
            if (match.Flags.Count > 0 || match.Finish != null)
            {
                VisualElement foot = Ui.El("ds-match__foot");
                foreach ((DsState state, string text) in match.Flags) foot.Add(Ds.Pill(state, text));
                if (match.Finish != null) foot.Add(Ui.Text(match.Finish, "ds-match__finish"));
                card.Add(foot);
            }
            return card;
        }

        private static VisualElement Side(MatchupSide side, bool mirrored, bool big, bool winner, bool loser)
        {
            VisualElement element = Ui.El("ds-match__side");
            if (mirrored) element.AddToClassList("ds-match__side--right");
            if (winner) element.AddToClassList("ds-match__side--winner");
            if (loser) element.AddToClassList("ds-match__side--loser");
            if (side == null) return element;
            element.Add(PortraitBox(side.Picture, side.Alignment, big ? "ds-portrait--lg" : "ds-portrait--sm", side.Champion != null, side.Name));
            VisualElement words = Ui.El("ds-match__words");
            if (side.Champion != null)
            {
                VisualElement belt = Ui.El("ds-match__champ");
                belt.Add(new Icon("crown", "ds-icon--xs"));
                belt.Add(Ui.Text("CHAMPION", "ds-match__champ-text"));
                words.Add(belt);
            }
            words.Add(Ui.Text(TextFormat.Upper(side.Name), "ds-match__name"));
            if (side.Members != null) words.Add(Ui.Text(side.Members, "ds-match__members"));
            VisualElement sub = Ui.El("ds-match__sub");
            sub.Add(Ds.Tag(side.Alignment.ToString(), side.Alignment.ToString().ToLowerInvariant()));
            if (side.Note != null) sub.Add(Ui.Text(side.Note, "ds-match__note"));
            words.Add(sub);
            element.Add(words);
            return element;
        }

        /// <summary>The promotion logo plate: the logo picture when there is one, else a monogram in its colour.</summary>
        public static VisualElement Logo(string monogram, string colorHex, string sizeClass = "ds-logo--md", Texture2D picture = null)
        {
            VisualElement plate = Ui.El("ds-logo", sizeClass);
            if (picture != null)
            {
                plate.style.backgroundImage = new StyleBackground(picture);
                return plate;
            }
            if (ColorUtility.TryParseHtmlString(colorHex, out Color color))
            {
                plate.Add(new GradientFill(color, Color.Lerp(color, Color.black, 0.55f)));
            }
            plate.Add(Ui.Text(TextFormat.Upper(monogram), "ds-logo__text"));
            return plate;
        }

        /// <summary>A show card: logo, name, when and where, how big it is, and how far booking has got.</summary>
        public static VisualElement ShowCard(ShowCardData show, bool wide = false)
        {
            VisualElement card = Ui.El("ds-show");
            if (wide) card.AddToClassList("ds-show--wide");
            card.Add(Logo(show.Logo, show.LogoColor, wide ? "ds-logo--lg" : "ds-logo--md"));
            VisualElement words = Ui.El("ds-show__words");
            VisualElement kicker = Ui.El("ds-row", "ds-show__kicker");
            kicker.Add(Ds.Pill(show.ImportanceState, show.Importance, show.ImportanceState == DsState.Gold ? "star" : "tv"));
            if (show.Countdown != null) kicker.Add(Ui.Text(TextFormat.Upper(show.Countdown), "ds-show__countdown"));
            words.Add(kicker);
            words.Add(Ui.Text(TextFormat.Upper(show.Name), "ds-show__name"));
            VisualElement meta = Ui.El("ds-row", "ds-show__meta");
            meta.Add(new Icon("calendar", "ds-icon--xs"));
            meta.Add(Ui.Text(show.When, "ds-show__meta-text"));
            meta.Add(new Icon("venue", "ds-icon--xs"));
            meta.Add(Ui.Text(show.Venue, "ds-show__meta-text"));
            words.Add(meta);
            card.Add(words);
            if (show.Slots > 0)
            {
                VisualElement progress = Ui.El("ds-show__progress");
                progress.Add(Ui.Text($"{show.Booked}/{show.Slots}", "ds-show__booked"));
                progress.Add(Ui.Text("BOOKED", "ds-show__booked-label"));
                card.Add(progress);
            }
            return card;
        }

        /// <summary>A news card: kicker, headline and one line of standfirst. <paramref name="lead"/> is the big top story.</summary>
        public static VisualElement NewsCard(NewsItem item, bool lead = false, Texture2D picture = null, Alignment tone = Alignment.Tweener, VisualElement feature = null)
        {
            VisualElement card = Ui.El("ds-news", Ds.StateClass(item.State));
            if (lead)
            {
                card.AddToClassList("ds-news--lead");
                VisualElement art = Ui.El("ds-news__art");
                if (feature != null)
                {
                    // A feature (two portraits facing off, a logo) on the right over a dark sweep.
                    art.Add(new GradientFill(new Color(0.06f, 0.09f, 0.17f, 1f), new Color(0.24f, 0.17f, 0.03f, 1f), horizontal: true));
                    feature.AddToClassList("ds-news__feature");
                    art.Add(feature);
                }
                else
                {
                    art.Add(new Portrait(picture, tone == Alignment.Tweener ? PortraitTone.Gold : Tone(tone)));
                }
                VisualElement shade = new GradientFill(new Color(0.035f, 0.05f, 0.086f, 0f), new Color(0.035f, 0.05f, 0.086f, 0.98f));
                shade.AddToClassList("ds-news__shade");
                art.Add(shade);
                card.Add(art);
            }
            VisualElement words = Ui.El("ds-news__words");
            VisualElement kicker = Ui.El("ds-news__kicker");
            kicker.Add(new Icon(item.Icon, "ds-icon--xs"));
            kicker.Add(Ui.Text(TextFormat.Upper(item.Kicker), "ds-news__kicker-text"));
            if (item.When != null) kicker.Add(Ui.Text(item.When, "ds-news__when"));
            words.Add(kicker);
            words.Add(Ui.Text(item.Headline, "ds-news__headline"));
            if (item.Dek != null) words.Add(Ui.Text(item.Dek, "ds-news__dek"));
            card.Add(words);
            return card;
        }

        /// <summary>A scoreboard strip: labelled numbers side by side with dividers (top bar, show so far).</summary>
        public static VisualElement Scoreboard(IEnumerable<(string label, string value, string sub, DsState state)> cells, string modifier = null)
        {
            VisualElement board = Ui.El("ds-scoreboard");
            if (modifier != null) board.AddToClassList("ds-scoreboard--" + modifier);
            foreach ((string label, string value, string sub, DsState state) in cells)
            {
                VisualElement cell = Ui.El("ds-scoreboard__cell", Ds.StateClass(state));
                cell.Add(Ui.Text(TextFormat.Upper(label), "ds-scoreboard__label"));
                cell.Add(Ui.Text(value, "ds-scoreboard__value"));
                if (sub != null) cell.Add(Ui.Text(sub, "ds-scoreboard__sub"));
                board.Add(cell);
            }
            return board;
        }

        /// <summary>
        /// The ticker: a skewed label then headlines separated by dots, sliding left on a loop (paused
        /// while hovered). <paramref name="animate"/> false keeps it still (screenshots).
        /// </summary>
        public static VisualElement Ticker(string label, IReadOnlyList<string> items, bool animate = true)
        {
            VisualElement ticker = Ui.El("ds-ticker");
            VisualElement tag = new SkewShape { SkewLeft = false };
            tag.AddToClassList("ds-ticker__label");
            tag.Add(Ui.Text(TextFormat.Upper(label), "ds-ticker__label-text"));
            ticker.Add(tag);
            VisualElement window = Ui.El("ds-ticker__window");
            VisualElement track = Ui.El("ds-ticker__track");
            for (int pass = 0; pass < 2; pass++)
            {
                foreach (string item in items)
                {
                    track.Add(Ui.Text(item, "ds-ticker__item"));
                    track.Add(Ui.El("ds-ticker__sep"));
                }
            }
            window.Add(track);
            ticker.Add(window);
            if (animate)
            {
                float x = 0;
                bool paused = false;
                ticker.RegisterCallback<PointerEnterEvent>(_ => paused = true);
                ticker.RegisterCallback<PointerLeaveEvent>(_ => paused = false);
                track.schedule.Execute(() =>
                {
                    if (paused) return;
                    float half = track.layout.width / 2f;
                    if (half <= 0) return;
                    x -= 1.2f;
                    if (-x >= half) x += half;
                    track.style.translate = new Translate(x, 0);
                }).Every(16);
            }
            return ticker;
        }
    }
}
