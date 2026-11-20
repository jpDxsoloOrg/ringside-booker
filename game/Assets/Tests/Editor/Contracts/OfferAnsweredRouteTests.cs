using NUnit.Framework;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.Tests.Contracts
{
    /// <summary>
    /// DRF-08: the "Offer answered" stop came back a second time. The day button opened Contracts ›
    /// Offers with the talks, but the stop was only cleared once the talks sheet had loaded, so a
    /// look at the stops in between (the next press, a skip) still saw it. The screen now marks the
    /// answer seen as soon as it arrives on that route.
    /// </summary>
    public sealed class OfferAnsweredRouteTests
    {
        [Test]
        public void TheDayButtonsRouteMarksThatAnswerSeenOnArrival()
        {
            var hit = new GateHit(EngineGateActions.OfferAnswered, "Kai Moreno signed with you", GateHints.OfferAnswered, new GateSubject("negotiation", "neg_0000000007"));
            (string label, ShellRoute to)? destination = DayControlLogic.GateDestination(hit);
            Assert.That(destination.HasValue, Is.True);
            Assert.That(ContractsScreen.AnswerSeenOnArrival(destination.Value.to), Is.EqualTo("neg_0000000007"));
        }

        [Test]
        public void OtherContractRoutesMarkNothing()
        {
            Assert.That(ContractsScreen.AnswerSeenOnArrival(ShellRoute.With("contracts", "tab", "offers")), Is.Null);
            Assert.That(ContractsScreen.AnswerSeenOnArrival(ShellRoute.With("contracts", "tab", "active", "employment", "emp_1")), Is.Null);
            Assert.That(ContractsScreen.AnswerSeenOnArrival(ShellRoute.With("news", "tab", "offers", "negotiation", "neg_1")), Is.Null);
            Assert.That(ContractsScreen.AnswerSeenOnArrival(null), Is.Null);
        }
    }
}
