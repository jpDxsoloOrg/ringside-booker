using System.Linq;
using NUnit.Framework;
using RingsideBooker.Help;

namespace RingsideBooker.Tests.Help
{
    /// <summary>First run (POL5-05): which sheet shows, the per-slot checklist progress, and resetting it.</summary>
    public sealed class FirstRunTests
    {
        private IHelpPrefs saved;
        private MemoryHelpPrefs prefs;

        [SetUp]
        public void SetUp()
        {
            saved = HelpPrefs.Store;
            prefs = new MemoryHelpPrefs();
            HelpPrefs.Store = prefs;
        }

        [TearDown]
        public void TearDown() => HelpPrefs.Store = saved;

        [Test]
        public void ANewGameGetsTheWelcomeALoadDoesNot()
        {
            Assert.AreEqual(FirstRunSheet.Welcome, FirstRun.Decide(newGame: true, welcomeOn: true, isAlpha: false, alphaHidden: false, alphaSeen: false));
            Assert.AreEqual(FirstRunSheet.None, FirstRun.Decide(newGame: false, welcomeOn: true, isAlpha: false, alphaHidden: false, alphaSeen: false));
            Assert.AreEqual(FirstRunSheet.None, FirstRun.Decide(newGame: true, welcomeOn: false, isAlpha: false, alphaHidden: false, alphaSeen: false));
        }

        [Test]
        public void TheAlphaNoticeShowsOnceEvenAfterALoad()
        {
            Assert.AreEqual(FirstRunSheet.AlphaOnly, FirstRun.Decide(newGame: false, welcomeOn: true, isAlpha: true, alphaHidden: false, alphaSeen: false));
            Assert.AreEqual(FirstRunSheet.None, FirstRun.Decide(newGame: false, welcomeOn: true, isAlpha: true, alphaHidden: false, alphaSeen: true));
            Assert.AreEqual(FirstRunSheet.None, FirstRun.Decide(newGame: false, welcomeOn: true, isAlpha: true, alphaHidden: true, alphaSeen: false));
            Assert.AreEqual(FirstRunSheet.AlphaOnly, FirstRun.Decide(newGame: true, welcomeOn: false, isAlpha: true, alphaHidden: false, alphaSeen: false));
        }

        [Test]
        public void TheWelcomeCarriesTheAlphaNoticeUntilHidden()
        {
            Assert.IsTrue(FirstRun.ShowsAlpha(FirstRunSheet.Welcome, isAlpha: true, alphaHidden: false));
            Assert.IsFalse(FirstRun.ShowsAlpha(FirstRunSheet.Welcome, isAlpha: true, alphaHidden: true));
            Assert.IsFalse(FirstRun.ShowsAlpha(FirstRunSheet.Welcome, isAlpha: false, alphaHidden: false));
            Assert.IsTrue(FirstRun.ShowsAlpha(FirstRunSheet.AlphaOnly, isAlpha: true, alphaHidden: false));
        }

        [Test]
        public void DontShowAgainSticks()
        {
            Assert.IsTrue(HelpPrefs.WelcomeOn);
            HelpPrefs.WelcomeOn = false;
            Assert.AreEqual("never", prefs.Get(HelpPrefs.WelcomeKey));
            Assert.IsFalse(HelpPrefs.WelcomeOn);
            HelpPrefs.AlphaHidden = true;
            Assert.IsTrue(HelpPrefs.AlphaHidden);
        }

        [Test]
        public void ChecklistProgressIsPerSlotAndDoneStaysDone()
        {
            Assert.IsTrue(HelpPrefs.MarkDone("slot-a", GettingStarted.BookShow));
            Assert.IsFalse(HelpPrefs.MarkDone("slot-a", GettingStarted.BookShow), "already done");
            HelpPrefs.MarkDone("slot-a", GettingStarted.ReadArticle);
            Assert.AreEqual(2, GettingStarted.CountDone(HelpPrefs.Done("slot-a")));
            Assert.AreEqual(0, GettingStarted.CountDone(HelpPrefs.Done("slot-b")));
        }

        [Test]
        public void TheChecklistHidesAndComesBack()
        {
            Assert.IsTrue(GettingStarted.ShouldShow("slot-a", hasPromotion: true));
            Assert.IsFalse(GettingStarted.ShouldShow("slot-a", hasPromotion: false), "no promotion, no checklist");
            HelpPrefs.SetChecklistHidden("slot-a", true);
            Assert.IsFalse(GettingStarted.ShouldShow("slot-a", true));
            Assert.IsTrue(GettingStarted.ShouldShow("slot-b", true));
            HelpPrefs.SetChecklistHidden("slot-a", false);
            Assert.IsTrue(GettingStarted.ShouldShow("slot-a", true));
            HelpPrefs.SetChecklistComplete("slot-a");
            Assert.IsFalse(GettingStarted.ShouldShow("slot-a", true), "seen with everything done");
            HelpPrefs.SetChecklistHidden("slot-a", false);
            Assert.IsTrue(GettingStarted.ShouldShow("slot-a", true), "Show again brings a finished list back too");
        }

        [Test]
        public void ResetBringsEverythingBack()
        {
            HelpPrefs.WelcomeOn = false;
            HelpPrefs.AlphaHidden = true;
            HelpPrefs.AlphaSeen = true;
            HelpPrefs.MarkDone("slot-a", GettingStarted.RunShow);
            HelpPrefs.SetChecklistHidden("slot-b", true);
            HelpPrefs.ResetAll();
            Assert.IsEmpty(prefs.Values, string.Join(", ", prefs.Values.Keys));
            Assert.IsTrue(HelpPrefs.WelcomeOn);
            Assert.IsTrue(GettingStarted.ShouldShow("slot-b", true));
        }

        [Test]
        public void TheChecklistHasTheFirstThingsToDo()
        {
            CollectionAssert.AreEqual(new[] { "book", "run", "results", "sign", "help" }, GettingStarted.Items.Select(item => item.Id).ToArray());
        }
    }
}
