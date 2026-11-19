using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.News;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.Tests.News
{
    /// <summary>The News screen's words and logic (UNITY-19), checked against the web's news catalog and screen.</summary>
    public sealed class NewsTests
    {
        private const string Ada = "per_0000000001";
        private const string Bo = "per_0000000002";
        private const string Gone = "per_000000000z";
        private const string Altura = "pro_0000000001";
        private const string Belt = "tit_0000000001";

        private static Dictionary<string, NewsName> Names() => NewsText.NamesFrom(JObject.Parse(
            $"{{\"{Ada}\":{{\"kind\":\"person\",\"name\":\"Ada Stone\"}},\"{Bo}\":{{\"kind\":\"person\",\"name\":\"Bo Reyes\"}}," +
            $"\"{Altura}\":{{\"kind\":\"promotion\",\"name\":\"Altura Wrestling\"}},\"{Belt}\":{{\"kind\":\"title\",\"name\":\"World Title\"}}}}"));

        private static JObject Text(string key, string parameters) => JObject.Parse($"{{\"key\":\"{key}\",\"params\":{parameters}}}");

        [Test]
        public void RendersNamesFromIds()
        {
            Assert.AreEqual("Altura Wrestling signs Ada Stone",
                NewsText.Render(Text("news.signing.headline", $"{{\"promotionId\":\"{Altura}\",\"personId\":\"{Ada}\"}}"), Names()));
        }

        [Test]
        public void JoinsSeveralHoldersAndPicksThePluralVerb()
        {
            string one = NewsText.Render(Text("news.title-change.headline", $"{{\"newHolderIds\":\"{Ada}\",\"titleId\":\"{Belt}\",\"previousHolderIds\":\"{Bo}\"}}"), Names());
            Assert.AreEqual("Ada Stone wins the World Title", one);
            string team = NewsText.Render(Text("news.title-change.headline", $"{{\"newHolderIds\":\"{Ada},{Bo}\",\"titleId\":\"{Belt}\"}}"), Names());
            Assert.AreEqual("Ada Stone and Bo Reyes are crowned World Title champion", team);
        }

        [Test]
        public void FormatsCountsDatesAndYears()
        {
            Assert.AreEqual("Ada Stone reaches 1 year holding the World Title",
                NewsText.Render(Text("news.reign-milestone.headline", $"{{\"holderIds\":\"{Ada}\",\"titleId\":\"{Belt}\",\"years\":1}}"), Names()));
            Assert.AreEqual("Ada Stone reaches 1,200 days holding the World Title",
                NewsText.Render(Text("news.reign-milestone.headline", $"{{\"holderIds\":\"{Ada}\",\"titleId\":\"{Belt}\",\"days\":1200}}"), Names()));
            Assert.AreEqual("Season 2 is under way in Altura. It opened on Monday, January 5, 2026 and runs until Thursday, December 31, 2026.",
                NewsText.Render(Text("news.season-start.body", "{\"seasonNumber\":2,\"worldName\":\"Altura\",\"startDate\":\"2026-01-05\",\"endDate\":\"2026-12-31\"}"), Names()));
        }

        [Test]
        public void GoneIdsAndMissingKeys()
        {
            Assert.AreEqual($"{NewsText.NoLongerInRecords} leaves Altura Wrestling",
                NewsText.Render(Text("news.departure.headline", $"{{\"personId\":\"{Gone}\",\"promotionId\":\"{Altura}\"}}"), Names()));
            Assert.AreEqual(NewsText.MissingText, NewsText.Render(Text("news.nobody-knows", "{}"), Names()));
            Assert.AreEqual("11th", NewsText.Ordinal(11));
            Assert.AreEqual("22nd", NewsText.Ordinal(22));
            Assert.AreEqual("A, B and C", NewsText.JoinNames(new[] { "A", "B", "C" }));
        }

        [Test]
        public void EntitiesComeFromRefsInOrder()
        {
            JObject item = JObject.Parse($"{{\"refs\":{{\"personIds\":[\"{Bo}\",\"{Gone}\"],\"promotionIds\":[\"{Altura}\"],\"eventInstanceId\":null}}}}");
            CollectionAssert.AreEqual(new[] { "Bo Reyes", "Altura Wrestling" }, NewsModel.EntitiesOf(item, Names()).Select(entity => entity.Name).ToArray());
            Assert.AreEqual(Altura, NewsModel.PromotionOf(item, Names()).Id);
        }

        [Test]
        public void FeedArgsFollowTheFilters()
        {
            var today = new GameDate(2027, 1, 31);
            JObject all = NewsModel.FeedArgs(NewsFilters.None, today, 1);
            Assert.AreEqual("{\"limit\":200}", all.ToString(Newtonsoft.Json.Formatting.None));
            NewsFilters filters = NewsFilters.FromRoute(ShellRoute.With("news", "kind", "signing,result,bogus", "mine", "1", "period", "7", "front", "1"));
            CollectionAssert.AreEqual(new[] { "result", "signing" }, filters.Kinds.ToArray());
            Assert.AreEqual(4, filters.ActiveCount);
            JObject args = NewsModel.FeedArgs(filters, today, 3);
            Assert.AreEqual("2027-01-25", (string)args["from"]);
            Assert.AreEqual(500, (int)args["limit"]);
            Assert.IsTrue((bool)args["mine"]);
            Assert.IsTrue((bool)args["frontPageOnly"]);
            Assert.AreEqual(0, filters.Toggle("result").Toggle("signing").Kinds.Count);
        }

        [Test]
        public void FrontPageLeadsWithTheFirstHero()
        {
            JObject top = JObject.Parse("{\"hero\":[{\"id\":\"a\"},{\"id\":\"b\"}],\"ticker\":[{\"id\":\"b\"},{\"id\":\"c\"},{\"id\":\"d\"}]}");
            (JToken lead, List<JToken> others) = NewsModel.FrontPage(top, 2);
            Assert.AreEqual("a", (string)lead["id"]);
            CollectionAssert.AreEqual(new[] { "b", "c" }, others.Select(story => (string)story["id"]).ToArray());
            Assert.IsNull(NewsModel.FrontPage(JObject.Parse("{\"hero\":[],\"ticker\":[]}")).lead);
        }

        [Test]
        public void WordsForCountsWhenKindsAndArchive()
        {
            Assert.AreEqual("2 stories", NewsModel.CountText(2, 2));
            Assert.AreEqual("Showing 200 of 340 stories", NewsModel.CountText(200, 340));
            var today = new GameDate(2027, 1, 31);
            Assert.AreEqual("Today", NewsModel.When("2027-01-31", today));
            Assert.AreEqual("Yesterday", NewsModel.When("2027-01-30", today));
            Assert.AreEqual("3 days ago", NewsModel.When("2027-01-28", today));
            Assert.AreEqual(DsState.Gold, NewsModel.KindState("titleChange"));
            Assert.AreEqual(DsState.Info, NewsModel.KindState("signing"));
            Assert.AreEqual("Kept in the archive", NewsModel.ArchiveText(JObject.Parse("{\"expiresOn\":null}")));
            Assert.AreEqual("Front page", NewsModel.ImportanceLabel(3));
        }

        [Test]
        public void AlertChangeKeepsOnlyWhatMoved()
        {
            JObject saved = JObject.Parse("{\"rules\":[{\"id\":\"a\",\"enabled\":true},{\"id\":\"b\",\"enabled\":false}],\"stopSkip\":true}");
            Assert.IsNull(NewsModel.AlertChange(saved, new Dictionary<string, bool> { ["a"] = true }, true));
            JObject change = NewsModel.AlertChange(saved, new Dictionary<string, bool> { ["a"] = true, ["b"] = true }, false);
            Assert.AreEqual("{\"rules\":{\"b\":true},\"stopSkip\":false}", change.ToString(Newtonsoft.Json.Formatting.None));
        }

        [Test]
        public void UnreadCountsStoriesSinceTheSeenDay()
        {
            Assert.AreEqual(("2027-01-04", 3), NewsSeen.Parse("2027-01-04|3"));
            Assert.IsNull(NewsSeen.Parse("garbage"));
            Assert.AreEqual(5, NewsSeen.Unread(8, ("2027-01-04", 3)));
            Assert.AreEqual(0, NewsSeen.Unread(2, ("2027-01-04", 3)));
            Assert.AreEqual(7, NewsSeen.Unread(7, null));
            Assert.AreEqual("2027-01-04", (string)NewsSeen.CountArgs(("2027-01-04", 3))["from"]);
            Assert.AreEqual("3 new stories", NavBadgeWords.For(NavBadgeKey.UnreadNews, 3));
        }
    }
}
