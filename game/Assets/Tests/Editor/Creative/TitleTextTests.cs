using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Screens.Creative;

namespace RingsideBooker.Tests.Creative
{
    /// <summary>The Titles screens' words and form rules (UNITY-16), checked against the web's.</summary>
    public sealed class TitleTextTests
    {
        [TestCase(92, "gold", "Top prize")]
        [TestCase(70, "gold", "Top prize")]
        [TestCase(69.9, "silver", "Respected")]
        [TestCase(45, "silver", "Respected")]
        [TestCase(20, "bronze", "Building")]
        [TestCase(5, "plain", "Minor")]
        public void BeltMetalAndPrestigeWordsFollowThePrestige(double prestige, string tier, string words)
        {
            Assert.AreEqual(tier, TitleText.BeltTier(prestige));
            Assert.AreEqual(words, TitleText.PrestigeWords(prestige));
        }

        [Test]
        public void SaysReignsAndRecordsInWords()
        {
            Assert.AreEqual("Won today", TitleText.ReignDays(0));
            Assert.AreEqual("1 day", TitleText.ReignDays(1));
            Assert.AreEqual("1,142 days", TitleText.ReignDays(1142));
            Assert.AreEqual("142 days · 1 defence", TitleText.ReignLine(142, 1));
            Assert.AreEqual("3 reigns", TitleText.RecordValue(3, "reigns"));
            Assert.AreEqual("1 year old", TitleText.RecordValue(1, "years"));
            Assert.AreEqual("41 years old", TitleText.RecordValue(41, "years"));
            Assert.AreEqual("Tag team", TitleText.HolderCount(2));
        }

        [Test]
        public void OffersActionsOnlyForTheOwnersTitles()
        {
            CollectionAssert.IsEmpty(TitleText.RowActions(false, "active", true));
            CollectionAssert.AreEqual(new[] { "reactivate" }, TitleText.RowActions(true, "retired", false));
            CollectionAssert.AreEqual(new[] { "edit", "award", "retire" }, TitleText.RowActions(true, "active", false));
            CollectionAssert.AreEqual(new[] { "edit", "award", "vacate", "retire" }, TitleText.RowActions(true, "active", true));
        }

        [Test]
        public void ConfirmsSayWhatEndsAndHow()
        {
            var vacate = TitleText.EndOrReturnCopy("vacate", "World Title", "Test Name");
            Assert.AreEqual("Vacate the World Title?", vacate.title);
            Assert.AreEqual("Test Name's reign ends today as Vacated.", vacate.body);
            Assert.IsTrue(vacate.danger);
            var retire = TitleText.EndOrReturnCopy("retire", "World Title", null);
            StringAssert.StartsWith("It moves to Retired. Its lineage is kept", retire.body);
            var back = TitleText.EndOrReturnCopy("reactivate", "World Title", null);
            Assert.AreEqual("Bring it back", back.confirm);
            Assert.IsFalse(back.danger);
            Assert.AreEqual("Test Team's reign ends as Stripped.", TitleText.AwardConfirmCopy("World Title", "A & B", "Test Team").body);
            Assert.AreEqual("Pick 2 people", TitleText.PickPrompt(2));
            Assert.AreEqual("Works across brands", TitleText.OtherBrandText(null));
        }

        [Test]
        public void CreateArgsCarryTheFormAndRefuseABadWeight()
        {
            var form = new TitleText.Form { Name = "Test Title", Brand = TitleText.PromotionWide, HolderCount = 2, Gender = "female", MinWeight = "", MaxWeight = "93,5", Tier = "world" };
            (JObject args, TitleText.FormErrors errors) = TitleText.CreateArgs("pro_1", form);
            Assert.IsNull(errors);
            Assert.AreEqual(JTokenType.Null, args["brandId"].Type);
            Assert.AreEqual(2, (int)args["holderCount"]);
            Assert.AreEqual(93.5, (double)args["division"]["maxWeightKg"]);
            Assert.AreEqual(JTokenType.Null, args["division"]["minWeightKg"].Type);
            Assert.AreEqual("world", (string)args["tier"]);

            form.MinWeight = "heavy";
            (JObject none, TitleText.FormErrors refused) = TitleText.CreateArgs("pro_1", form);
            Assert.IsNull(none);
            Assert.AreEqual(TitleText.WeightNotANumber, refused.Of("minWeight"));
        }

        [Test]
        public void EditKeepsStoredWeightsAndSendsHoldersOnlyWhenChanged()
        {
            JToken row = JObject.Parse("{\"titleId\":\"tit_1\",\"name\":\"Old\",\"brandId\":\"brd_1\",\"holderCount\":1,\"color\":\"#C9A227\",\"division\":{\"gender\":\"open\",\"minWeightKg\":null,\"maxWeightKg\":93.4}}");
            TitleText.Form form = TitleText.Form.FromRow(row);
            Assert.AreEqual("93", form.MaxWeight);
            Assert.AreEqual("#c9a227", form.Color);
            form.Name = "New";
            (JObject args, TitleText.FormErrors _) = TitleText.EditArgs(row, form);
            Assert.AreEqual(93.4, (double)args["division"]["maxWeightKg"]);
            Assert.AreEqual("brd_1", (string)args["brandId"]);
            Assert.IsFalse(args.ContainsKey("holderCount"));
            form.HolderCount = 3;
            Assert.AreEqual(3, (int)TitleText.EditArgs(row, form).args["holderCount"]);
        }

        [Test]
        public void RefusalsGoUnderTheFieldsTheyName()
        {
            TitleText.FormErrors errors = TitleText.ErrorsFromReasons(new[]
            {
                ("x", "name", "Too long."),
                ("y", "name", "Taken."),
                ("z", "division.maxWeightKg", "Too light."),
                ("w", (string)null, "Not yours."),
            });
            Assert.AreEqual("Too long. Taken.", errors.Of("name"));
            Assert.AreEqual("Too light.", errors.Of("maxWeight"));
            Assert.AreEqual("Not yours.", errors.General.Single());
        }
    }
}
