using System;
using System.Numerics;
using System.Security.Cryptography;

namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// Ed25519 (RFC 8032) for the tester licence (POL9-12). Unity's .NET profile has no Ed25519, so
    /// this is a small implementation written for the game from the RFC's algorithm (section 5.1),
    /// on <see cref="BigInteger"/> and extended coordinates. It is slow next to a native library (a
    /// few milliseconds per check) but the game checks one token at start-up, so that does not
    /// matter. <see cref="Sign"/> exists for the tests, which sign their own tokens with fixed keys;
    /// the game itself only verifies.
    /// </summary>
    public static class Ed25519
    {
        public const int PublicKeySize = 32;
        public const int SignatureSize = 64;
        public const int SeedSize = 32;

        private static readonly BigInteger P = BigInteger.Pow(2, 255) - 19;
        private static readonly BigInteger Q = BigInteger.Pow(2, 252) + BigInteger.Parse("27742317777372353535851937790883648493");
        private static readonly BigInteger D = Mod(-121665 * Inverse(121666));
        private static readonly BigInteger SqrtMinusOne = BigInteger.ModPow(2, (P - 1) / 4, P);
        private static readonly Point Base = MakeBase();

        /// <summary>True when <paramref name="signature"/> is a valid signature of <paramref name="message"/> by the key.</summary>
        public static bool Verify(byte[] publicKey, byte[] message, byte[] signature)
        {
            if (publicKey == null || publicKey.Length != PublicKeySize) return false;
            if (signature == null || signature.Length != SignatureSize || message == null) return false;
            Point? a = Decompress(publicKey);
            if (a == null) return false;
            byte[] rBytes = Slice(signature, 0, 32);
            Point? r = Decompress(rBytes);
            if (r == null) return false;
            BigInteger s = FromLittleEndian(Slice(signature, 32, 32));
            if (s >= Q) return false;
            BigInteger h = HashModQ(rBytes, publicKey, message);
            Point sB = Multiply(s, Base);
            Point hA = Multiply(h, a.Value);
            return AreEqual(sB, Add(r.Value, hA));
        }

        /// <summary>The 32-byte public key for a 32-byte private seed.</summary>
        public static byte[] PublicKeyFromSeed(byte[] seed)
        {
            (BigInteger a, _) = Expand(seed);
            return Compress(Multiply(a, Base));
        }

        /// <summary>Signs with a 32-byte private seed (tests only; the game never holds a private key).</summary>
        public static byte[] Sign(byte[] seed, byte[] message)
        {
            (BigInteger a, byte[] prefix) = Expand(seed);
            byte[] publicKey = Compress(Multiply(a, Base));
            BigInteger r = HashModQ(prefix, message);
            byte[] rBytes = Compress(Multiply(r, Base));
            BigInteger h = HashModQ(rBytes, publicKey, message);
            BigInteger s = (r + h * a) % Q;
            byte[] signature = new byte[SignatureSize];
            Buffer.BlockCopy(rBytes, 0, signature, 0, 32);
            Buffer.BlockCopy(ToLittleEndian(s), 0, signature, 32, 32);
            return signature;
        }

        private readonly struct Point
        {
            public readonly BigInteger X, Y, Z, T;

            public Point(BigInteger x, BigInteger y, BigInteger z, BigInteger t)
            {
                X = x;
                Y = y;
                Z = z;
                T = t;
            }
        }

        private static Point MakeBase()
        {
            BigInteger y = Mod(4 * Inverse(5));
            BigInteger x = RecoverX(y, 0) ?? throw new InvalidOperationException("Ed25519 base point");
            return new Point(x, y, 1, Mod(x * y));
        }

        private static BigInteger Mod(BigInteger value)
        {
            BigInteger result = value % P;
            return result.Sign < 0 ? result + P : result;
        }

        private static BigInteger Inverse(BigInteger value) => BigInteger.ModPow(Mod(value), P - 2, P);

        private static Point Add(Point p, Point q)
        {
            BigInteger a = Mod((p.Y - p.X) * (q.Y - q.X));
            BigInteger b = Mod((p.Y + p.X) * (q.Y + q.X));
            BigInteger c = Mod(2 * p.T * q.T * D);
            BigInteger d = Mod(2 * p.Z * q.Z);
            BigInteger e = b - a, f = d - c, g = d + c, h = b + a;
            return new Point(Mod(e * f), Mod(g * h), Mod(f * g), Mod(e * h));
        }

        private static Point Multiply(BigInteger scalar, Point point)
        {
            var result = new Point(0, 1, 1, 0);
            while (scalar.Sign > 0)
            {
                if (!scalar.IsEven) result = Add(result, point);
                point = Add(point, point);
                scalar >>= 1;
            }
            return result;
        }

        private static bool AreEqual(Point p, Point q) =>
            Mod(p.X * q.Z - q.X * p.Z).IsZero && Mod(p.Y * q.Z - q.Y * p.Z).IsZero;

        private static BigInteger? RecoverX(BigInteger y, int sign)
        {
            if (y >= P) return null;
            BigInteger x2 = Mod((y * y - 1) * Inverse(D * y * y + 1));
            if (x2.IsZero) return sign == 0 ? BigInteger.Zero : (BigInteger?)null;
            BigInteger x = BigInteger.ModPow(x2, (P + 3) / 8, P);
            if (!Mod(x * x - x2).IsZero) x = Mod(x * SqrtMinusOne);
            if (!Mod(x * x - x2).IsZero) return null;
            if ((int)(x & 1) != sign) x = P - x;
            return x;
        }

        private static byte[] Compress(Point point)
        {
            BigInteger zInverse = Inverse(point.Z);
            BigInteger x = Mod(point.X * zInverse);
            BigInteger y = Mod(point.Y * zInverse);
            byte[] bytes = ToLittleEndian(y);
            if (!x.IsEven) bytes[31] |= 0x80;
            return bytes;
        }

        private static Point? Decompress(byte[] bytes)
        {
            if (bytes.Length != 32) return null;
            int sign = bytes[31] >> 7;
            byte[] copy = (byte[])bytes.Clone();
            copy[31] &= 0x7f;
            BigInteger y = FromLittleEndian(copy);
            BigInteger? x = RecoverX(y, sign);
            if (x == null) return null;
            return new Point(x.Value, y, 1, Mod(x.Value * y));
        }

        private static (BigInteger a, byte[] prefix) Expand(byte[] seed)
        {
            if (seed == null || seed.Length != SeedSize) throw new ArgumentException("An Ed25519 seed is 32 bytes.", nameof(seed));
            byte[] hash = Sha512(seed);
            byte[] low = Slice(hash, 0, 32);
            low[0] &= 248;
            low[31] &= 127;
            low[31] |= 64;
            return (FromLittleEndian(low), Slice(hash, 32, 32));
        }

        private static BigInteger HashModQ(params byte[][] parts)
        {
            int length = 0;
            foreach (byte[] part in parts) length += part.Length;
            byte[] all = new byte[length];
            int offset = 0;
            foreach (byte[] part in parts)
            {
                Buffer.BlockCopy(part, 0, all, offset, part.Length);
                offset += part.Length;
            }
            return FromLittleEndian(Sha512(all)) % Q;
        }

        private static byte[] Sha512(byte[] data)
        {
            using (SHA512 sha = SHA512.Create()) return sha.ComputeHash(data);
        }

        private static byte[] Slice(byte[] bytes, int start, int length)
        {
            byte[] part = new byte[length];
            Buffer.BlockCopy(bytes, start, part, 0, length);
            return part;
        }

        // Unsigned little-endian bytes to a number (a trailing zero keeps BigInteger from reading a sign).
        private static BigInteger FromLittleEndian(byte[] bytes)
        {
            byte[] unsigned = new byte[bytes.Length + 1];
            Buffer.BlockCopy(bytes, 0, unsigned, 0, bytes.Length);
            return new BigInteger(unsigned);
        }

        private static byte[] ToLittleEndian(BigInteger value)
        {
            byte[] raw = value.ToByteArray();
            byte[] bytes = new byte[32];
            Buffer.BlockCopy(raw, 0, bytes, 0, Math.Min(raw.Length, 32));
            return bytes;
        }
    }
}
