using System;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using RingsideBooker.Release;
using RingsideBooker.Release.Access;

namespace RingsideBooker.Tests.Release
{
    /// <summary>
    /// Tester access (POL9-12): Ed25519, the licence token, the channel and grace rules, the reply
    /// parser and the stored file. Fixed keys and fixed times; no network.
    /// </summary>
    public sealed class AccessTests
    {
        // Seeds 0..31 and 32..63: the test signing keys (never the service's key).
        private static readonly byte[] SeedA = Enumerable.Range(0, 32).Select(index => (byte)index).ToArray();
        private static readonly byte[] SeedB = Enumerable.Range(32, 32).Select(index => (byte)index).ToArray();
        private static readonly byte[] KeyA = Ed25519.PublicKeyFromSeed(SeedA);

        private const string Install = "install-0001";
        private static readonly DateTime Now = new DateTime(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);
        private static long Unix(DateTime utc) => new DateTimeOffset(utc).ToUnixTimeSeconds();

        private static LicencePayload Payload(string channel = "alpha", double issuedDaysAgo = 1, double expiresInDays = 29, string install = Install) =>
            new LicencePayload
            {
                CodeId = "c0123456789abcdef0123",
                Channel = channel,
                InstallId = install,
                Hint = "RB-7K3M",
                Issued = Unix(Now.AddDays(-issuedDaysAgo)),
                Expires = Unix(Now.AddDays(expiresInDays)),
            };

        private static byte[] Hex(string hex) =>
            Enumerable.Range(0, hex.Length / 2).Select(index => Convert.ToByte(hex.Substring(index * 2, 2), 16)).ToArray();

        // RFC 8032 section 7.1, tests 1 and 2.
        [TestCase("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")]
        [TestCase("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")]
        public void Ed25519_MatchesTheRfcVectors(string seed, string publicKey, string message, string signature)
        {
            Assert.That(Ed25519.PublicKeyFromSeed(Hex(seed)), Is.EqualTo(Hex(publicKey)));
            Assert.That(Ed25519.Sign(Hex(seed), Hex(message)), Is.EqualTo(Hex(signature)));
            Assert.That(Ed25519.Verify(Hex(publicKey), Hex(message), Hex(signature)), Is.True);

            byte[] bent = Hex(signature);
            bent[10] ^= 1;
            Assert.That(Ed25519.Verify(Hex(publicKey), Hex(message), bent), Is.False);
            Assert.That(Ed25519.Verify(Hex(publicKey), Encoding.ASCII.GetBytes("other"), Hex(signature)), Is.False);
        }

        [Test]
        public void Ed25519_RefusesBadSizes()
        {
            Assert.That(Ed25519.Verify(new byte[31], new byte[0], new byte[64]), Is.False);
            Assert.That(Ed25519.Verify(KeyA, new byte[0], new byte[63]), Is.False);
        }

        [Test]
        public void Token_SignedByTheServiceCodeReadsHere()
        {
            // Made by Node's crypto (services/access/src/token.ts encodeToken) with seed A.
            const string fromNode =
                "eyJ2IjoxLCJjaWQiOiJjMDEyMzQ1Njc4OWFiY2RlZjAxMjMiLCJjaCI6ImFscGhhIiwiaWlkIjoiaW5zdGFsbC0wMDAxIiwiaGludCI6IlJCLTdLM00iLCJpYXQiOjE3OTUwMDAwMDAsImV4cCI6MTc5NzU5MjAwMH0" +
                ".-lDTrXNNLFBavrslw30sKxlE2jRVNDTuGQXbpzvomDQEWAUGab2GDoRcuj5r46M-47DnKJRawLAEk6XSZK2gBg";
            Assert.That(Convert.ToBase64String(KeyA), Is.EqualTo("A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg="));
            Assert.That(LicenceToken.Read(fromNode, KeyA, out LicencePayload payload), Is.EqualTo(TokenRead.Ok));
            Assert.That(payload.CodeId, Is.EqualTo("c0123456789abcdef0123"));
            Assert.That(payload.Channel, Is.EqualTo("alpha"));
            Assert.That(payload.InstallId, Is.EqualTo(Install));
            Assert.That(payload.Issued, Is.EqualTo(1795000000));
            Assert.That(payload.Expires, Is.EqualTo(1797592000));
            Assert.That(payload.MaskedCode, Is.EqualTo("RB-7K3M-••••"));
        }

        [Test]
        public void Verdict_ValidTokenIsActive()
        {
            string token = LicenceToken.Write(Payload(), SeedA);
            Assert.That(AccessPolicy.Evaluate(token, KeyA, "alpha", Install, Now, out LicencePayload payload), Is.EqualTo(AccessVerdict.Active));
            Assert.That(payload.Hint, Is.EqualTo("RB-7K3M"));
        }

        [Test]
        public void Verdict_ExpiredTokenWantsACheckIn()
        {
            string token = LicenceToken.Write(Payload(issuedDaysAgo: 31, expiresInDays: -1), SeedA);
            Assert.That(AccessPolicy.Evaluate(token, KeyA, "alpha", Install, Now, out LicencePayload payload), Is.EqualTo(AccessVerdict.Expired));
            Assert.That(payload, Is.Not.Null, "an expired token still reads, so it can be refreshed");
        }

        [Test]
        public void Verdict_WrongSignatureIsInvalid()
        {
            string otherKey = LicenceToken.Write(Payload(), SeedB);
            Assert.That(AccessPolicy.Evaluate(otherKey, KeyA, "alpha", Install, Now, out _), Is.EqualTo(AccessVerdict.Invalid));

            // A payload swapped under a good signature.
            string good = LicenceToken.Write(Payload(), SeedA);
            string longer = LicenceToken.Write(Payload(expiresInDays: 400), SeedB);
            string spliced = longer.Split('.')[0] + "." + good.Split('.')[1];
            Assert.That(LicenceToken.Read(spliced, KeyA, out _), Is.EqualTo(TokenRead.BadSignature));
            Assert.That(AccessPolicy.Evaluate(spliced, KeyA, "alpha", Install, Now, out _), Is.EqualTo(AccessVerdict.Invalid));
        }

        [TestCase("beta", "alpha", AccessVerdict.WrongChannel)]
        [TestCase("beta", "beta", AccessVerdict.Active)]
        [TestCase("alpha", "beta", AccessVerdict.Active)]
        [TestCase("alpha", "release", AccessVerdict.WrongChannel)]
        [TestCase("dev", "alpha", AccessVerdict.WrongChannel)]
        public void Verdict_Channels(string codeChannel, string buildChannel, AccessVerdict expected)
        {
            string token = LicenceToken.Write(Payload(channel: codeChannel), SeedA);
            Assert.That(AccessPolicy.Evaluate(token, KeyA, buildChannel, Install, Now, out _), Is.EqualTo(expected));
        }

        [Test]
        public void Verdict_AnotherComputersTokenIsInvalid()
        {
            string token = LicenceToken.Write(Payload(install: "install-0002"), SeedA);
            Assert.That(AccessPolicy.Evaluate(token, KeyA, "alpha", Install, Now, out _), Is.EqualTo(AccessVerdict.Invalid));
        }

        [TestCase(null, AccessVerdict.Missing)]
        [TestCase("", AccessVerdict.Missing)]
        [TestCase("not-a-token", AccessVerdict.Invalid)]
        [TestCase("a.b.c", AccessVerdict.Invalid)]
        [TestCase("e30.AAAA", AccessVerdict.Invalid)]
        public void Verdict_MissingOrBroken(string token, AccessVerdict expected)
        {
            Assert.That(AccessPolicy.Evaluate(token, KeyA, "alpha", Install, Now, out _), Is.EqualTo(expected));
        }

        [Test]
        public void Verdict_NoKeyMeansNothingVerifies()
        {
            string token = LicenceToken.Write(Payload(), SeedA);
            Assert.That(AccessPolicy.Evaluate(token, Array.Empty<byte>(), "alpha", Install, Now, out _), Is.EqualTo(AccessVerdict.Invalid));
        }

        [Test]
        public void Grace_ThirtyDaysOfflineThenACheckIn()
        {
            // Issued at the last check; the service sets exp to 30 days later.
            DateTime checkedAt = Now;
            LicencePayload payload = Payload(issuedDaysAgo: 0, expiresInDays: 30);
            Assert.That(AccessPolicy.Evaluate(payload, "alpha", Install, checkedAt.AddDays(29.9)), Is.EqualTo(AccessVerdict.Active));
            Assert.That(AccessPolicy.Evaluate(payload, "alpha", Install, checkedAt.AddDays(30)), Is.EqualTo(AccessVerdict.Expired));
            Assert.That(AccessPolicy.DaysLeft(payload, checkedAt.AddDays(20)), Is.EqualTo(10));
            Assert.That(AccessPolicy.DaysLeft(payload, checkedAt.AddDays(31)), Is.EqualTo(0));
        }

        [Test]
        public void Grace_ATokenFromTheFutureIsRefused()
        {
            LicencePayload payload = Payload(issuedDaysAgo: -3, expiresInDays: 33);
            Assert.That(AccessPolicy.Evaluate(payload, "alpha", Install, Now), Is.EqualTo(AccessVerdict.Invalid));
            LicencePayload slightly = Payload(issuedDaysAgo: -0.5, expiresInDays: 30);
            Assert.That(AccessPolicy.Evaluate(slightly, "alpha", Install, Now), Is.EqualTo(AccessVerdict.Active), "a clock a few hours off is fine");
        }

        [Test]
        public void Refresh_WeeklyAndAtMostDailyAfterAFailedTry()
        {
            LicencePayload sixDays = Payload(issuedDaysAgo: 6, expiresInDays: 24);
            LicencePayload eightDays = Payload(issuedDaysAgo: 8, expiresInDays: 22);
            LicencePayload expired = Payload(issuedDaysAgo: 31, expiresInDays: -1);
            Assert.That(AccessPolicy.RefreshDue(sixDays, null, Now), Is.False);
            Assert.That(AccessPolicy.RefreshDue(eightDays, null, Now), Is.True);
            Assert.That(AccessPolicy.RefreshDue(eightDays, Now.AddHours(-2), Now), Is.False);
            Assert.That(AccessPolicy.RefreshDue(eightDays, Now.AddDays(-2), Now), Is.True);
            Assert.That(AccessPolicy.RefreshDue(expired, null, Now), Is.True);
            Assert.That(AccessPolicy.RefreshDue(eightDays, Now.AddDays(5), Now), Is.True, "a last try in the future (clock change) doesn't block");
            Assert.That(AccessPolicy.RefreshDue(null, null, Now), Is.False);
        }

        [Test]
        public void Gate_OnlyAlphaAndBetaChannels()
        {
            Assert.That(AccessPolicy.IsGatedChannel(ReleaseInfo.ChannelAlpha), Is.True);
            Assert.That(AccessPolicy.IsGatedChannel(ReleaseInfo.ChannelBeta), Is.True);
            Assert.That(AccessPolicy.IsGatedChannel(ReleaseInfo.ChannelRelease), Is.False);
            Assert.That(AccessPolicy.IsGatedChannel(ReleaseInfo.ChannelLocal), Is.False);
        }

        [Test]
        public void Gate_TheEditorNeverShowsIt()
        {
            Assert.That(AccessService.AppliesToBuild, Is.False);
            Assert.That(AccessService.GateRequired, Is.False);
        }

        [TestCase("rb-7k3m-q9tx", "RB-7K3M-Q9TX")]
        [TestCase(" RB 7K3M Q9TX ", "RB-7K3M-Q9TX")]
        [TestCase("7K3MQ9TX", "RB-7K3M-Q9TX")]
        [TestCase("RB-7K3M-Q9T", null)]
        [TestCase("RB-7K3M-Q9T0", null)]
        [TestCase("RB-OIL1-Q9TX", null)]
        [TestCase("", null)]
        [TestCase(null, null)]
        public void Code_ReadsWhatThePlayerTyped(string typed, string expected)
        {
            Assert.That(AccessCode.Normalise(typed), Is.EqualTo(expected));
        }

        [Test]
        public void Reply_ParsesTheServiceAnswers()
        {
            AccessReply ok = AccessReply.Parse(200, "{\"ok\":true,\"token\":\"abc.def\",\"expires\":1}");
            Assert.That(ok.Ok, Is.True);
            Assert.That(ok.Token, Is.EqualTo("abc.def"));
            Assert.That(AccessReply.Parse(403, "{\"ok\":false,\"error\":\"too_many_computers\"}").Error, Is.EqualTo("too_many_computers"));
            Assert.That(AccessReply.Parse(429, "{\"message\":\"Too Many Requests\"}").Error, Is.EqualTo("rate_limited"));
            Assert.That(AccessReply.Parse(502, "<html>").Error, Is.EqualTo("server_error"));
            Assert.That(AccessReply.Parse(0, null).Error, Is.EqualTo(AccessMessages.Network));
        }

        [Test]
        public void Messages_PlainWordsForEveryError()
        {
            string[] errors = { "invalid_code", "too_many_computers", "revoked", "expired", "wrong_channel", "not_activated", "invalid_token", "rate_limited", "bad_request", AccessMessages.Network, "server_error" };
            string[] texts = errors.Select(AccessMessages.ForError).ToArray();
            Assert.That(texts.Distinct().Count(), Is.EqualTo(errors.Length));
            Assert.That(AccessMessages.ForError("invalid_code"), Does.StartWith("That code isn't valid"));
            Assert.That(AccessMessages.ForError("too_many_computers"), Does.StartWith("This code has been used on too many computers"));
            Assert.That(AccessMessages.ForError(AccessMessages.Network), Does.StartWith("Couldn't reach the server"));
            Assert.That(AccessMessages.EndsAccess("revoked"), Is.True);
            Assert.That(AccessMessages.EndsAccess(AccessMessages.Network), Is.False, "offline keeps the licence");
            Assert.That(AccessMessages.EndsAccess("server_error"), Is.False);
            Assert.That(AccessMessages.EndsAccess("rate_limited"), Is.False);
        }

        [Test]
        public void Store_KeepsTheInstallIdWhenTheCodeIsRemoved()
        {
            string folder = Path.Combine(Path.GetTempPath(), "rb-access-test-" + Guid.NewGuid().ToString("N"));
            try
            {
                var store = new AccessStore(folder);
                string install = store.InstallId;
                Assert.That(install, Is.Not.Empty);
                store.SetToken("abc.def");
                store.MarkAttempt(Now);

                var again = new AccessStore(folder);
                Assert.That(again.InstallId, Is.EqualTo(install));
                Assert.That(again.Token, Is.EqualTo("abc.def"));
                Assert.That(again.LastAttemptUtc, Is.EqualTo(Now));

                again.ClearToken();
                var after = new AccessStore(folder);
                Assert.That(after.Token, Is.Null);
                Assert.That(after.InstallId, Is.EqualTo(install));
            }
            finally
            {
                if (Directory.Exists(folder)) Directory.Delete(folder, true);
            }
        }

        [Test]
        public void Store_ABrokenFileAsksForTheCodeAgain()
        {
            string folder = Path.Combine(Path.GetTempPath(), "rb-access-test-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(folder);
                File.WriteAllText(Path.Combine(folder, AccessStore.FileName), "{ not json");
                UnityEngine.TestTools.LogAssert.ignoreFailingMessages = true;
                var store = new AccessStore(folder);
                Assert.That(store.Token, Is.Null);
                Assert.That(store.InstallId, Is.Not.Empty);
            }
            finally
            {
                UnityEngine.TestTools.LogAssert.ignoreFailingMessages = false;
                if (Directory.Exists(folder)) Directory.Delete(folder, true);
            }
        }
    }
}
