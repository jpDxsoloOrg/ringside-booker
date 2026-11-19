using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// SVG path data parsed into absolute figures of lines and cubic curves (arcs and quadratics are
    /// turned into cubics), ready to draw with <see cref="Painter2D"/>. Enough of the SVG path grammar
    /// for the Lucide icon set: M L H V C S Q T A Z, absolute and relative.
    /// </summary>
    public sealed class SvgPath
    {
        public readonly struct Segment
        {
            public Segment(Vector2 control1, Vector2 control2, Vector2 end, bool curve)
            {
                Control1 = control1;
                Control2 = control2;
                End = end;
                IsCurve = curve;
            }

            public Vector2 Control1 { get; }
            public Vector2 Control2 { get; }
            public Vector2 End { get; }
            public bool IsCurve { get; }
        }

        public sealed class Figure
        {
            public Vector2 Start;
            public readonly List<Segment> Segments = new List<Segment>();
            public bool Closed;
        }

        public SvgPath(IReadOnlyList<Figure> figures) => Figures = figures;

        public IReadOnlyList<Figure> Figures { get; }

        /// <summary>Adds every figure to the painter's current path, scaled and offset.</summary>
        public void AddTo(Painter2D painter, float scale, Vector2 offset)
        {
            foreach (Figure figure in Figures)
            {
                painter.MoveTo(figure.Start * scale + offset);
                foreach (Segment segment in figure.Segments)
                {
                    if (segment.IsCurve)
                    {
                        painter.BezierCurveTo(segment.Control1 * scale + offset, segment.Control2 * scale + offset, segment.End * scale + offset);
                    }
                    else
                    {
                        painter.LineTo(segment.End * scale + offset);
                    }
                }
                if (figure.Closed) painter.ClosePath();
            }
        }

        public static SvgPath Parse(string data)
        {
            var reader = new Reader(data ?? string.Empty);
            var figures = new List<Figure>();
            Figure figure = null;
            Vector2 current = Vector2.zero;
            Vector2 lastControl = Vector2.zero;
            char lastCommand = ' ';
            char command = ' ';

            while (true)
            {
                reader.SkipSeparators();
                if (reader.AtEnd) break;
                if (reader.PeekCommand(out char next)) command = next;
                else if (command == ' ') throw new FormatException("path data must start with a command");
                else if (command == 'M') command = 'L';
                else if (command == 'm') command = 'l';

                bool relative = char.IsLower(command);
                Vector2 origin = relative ? current : Vector2.zero;
                switch (char.ToUpperInvariant(command))
                {
                    case 'M':
                        current = origin + reader.Point();
                        figure = new Figure { Start = current };
                        figures.Add(figure);
                        lastControl = current;
                        break;
                    case 'L':
                        current = origin + reader.Point();
                        Add(ref figure, figures, current).Segments.Add(Line(current));
                        break;
                    case 'H':
                        current = new Vector2((relative ? current.x : 0) + reader.Number(), current.y);
                        Add(ref figure, figures, current).Segments.Add(Line(current));
                        break;
                    case 'V':
                        current = new Vector2(current.x, (relative ? current.y : 0) + reader.Number());
                        Add(ref figure, figures, current).Segments.Add(Line(current));
                        break;
                    case 'C':
                    {
                        Vector2 c1 = origin + reader.Point();
                        Vector2 c2 = origin + reader.Point();
                        Vector2 end = origin + reader.Point();
                        Add(ref figure, figures, current).Segments.Add(new Segment(c1, c2, end, true));
                        lastControl = c2;
                        current = end;
                        break;
                    }
                    case 'S':
                    {
                        Vector2 c1 = "CcSs".IndexOf(lastCommand) >= 0 ? 2 * current - lastControl : current;
                        Vector2 c2 = origin + reader.Point();
                        Vector2 end = origin + reader.Point();
                        Add(ref figure, figures, current).Segments.Add(new Segment(c1, c2, end, true));
                        lastControl = c2;
                        current = end;
                        break;
                    }
                    case 'Q':
                    {
                        Vector2 q = origin + reader.Point();
                        Vector2 end = origin + reader.Point();
                        Add(ref figure, figures, current).Segments.Add(Quadratic(current, q, end));
                        lastControl = q;
                        current = end;
                        break;
                    }
                    case 'T':
                    {
                        Vector2 q = "QqTt".IndexOf(lastCommand) >= 0 ? 2 * current - lastControl : current;
                        Vector2 end = origin + reader.Point();
                        Add(ref figure, figures, current).Segments.Add(Quadratic(current, q, end));
                        lastControl = q;
                        current = end;
                        break;
                    }
                    case 'A':
                    {
                        float rx = reader.Number();
                        float ry = reader.Number();
                        float rotation = reader.Number();
                        bool largeArc = reader.Flag();
                        bool sweep = reader.Flag();
                        Vector2 end = origin + reader.Point();
                        Figure target = Add(ref figure, figures, current);
                        ArcToCubics(current, end, rx, ry, rotation, largeArc, sweep, target.Segments);
                        current = end;
                        break;
                    }
                    case 'Z':
                        if (figure != null)
                        {
                            figure.Closed = true;
                            current = figure.Start;
                            figure = null;
                        }
                        break;
                    default:
                        throw new FormatException($"unsupported path command '{command}'");
                }
                if (char.ToUpperInvariant(command) != 'C' && char.ToUpperInvariant(command) != 'S' &&
                    char.ToUpperInvariant(command) != 'Q' && char.ToUpperInvariant(command) != 'T')
                {
                    lastControl = current;
                }
                lastCommand = command;
            }
            return new SvgPath(figures);
        }

        private static Figure Add(ref Figure figure, List<Figure> figures, Vector2 current)
        {
            if (figure != null) return figure;
            // A drawing command after Z starts a new figure at the closed figure's start.
            figure = new Figure { Start = current };
            figures.Add(figure);
            return figure;
        }

        private static Segment Line(Vector2 end) => new Segment(end, end, end, false);

        private static Segment Quadratic(Vector2 start, Vector2 control, Vector2 end) =>
            new Segment(start + 2f / 3f * (control - start), end + 2f / 3f * (control - end), end, true);

        /// <summary>SVG endpoint arc to cubic Béziers (SVG 1.1 appendix F.6), at most 90° each.</summary>
        private static void ArcToCubics(Vector2 start, Vector2 end, float rx, float ry, float rotationDegrees,
            bool largeArc, bool sweep, List<Segment> into)
        {
            if (start == end) return;
            rx = Mathf.Abs(rx);
            ry = Mathf.Abs(ry);
            if (rx < 1e-6f || ry < 1e-6f)
            {
                into.Add(Line(end));
                return;
            }

            double phi = rotationDegrees * Math.PI / 180.0;
            double cosPhi = Math.Cos(phi);
            double sinPhi = Math.Sin(phi);
            double dx = (start.x - end.x) / 2.0;
            double dy = (start.y - end.y) / 2.0;
            double x1 = cosPhi * dx + sinPhi * dy;
            double y1 = -sinPhi * dx + cosPhi * dy;

            double rxs = rx * rx;
            double rys = ry * ry;
            double lambda = x1 * x1 / rxs + y1 * y1 / rys;
            if (lambda > 1)
            {
                double root = Math.Sqrt(lambda);
                rx = (float)(rx * root);
                ry = (float)(ry * root);
                rxs = rx * rx;
                rys = ry * ry;
            }

            double numerator = rxs * rys - rxs * y1 * y1 - rys * x1 * x1;
            double denominator = rxs * y1 * y1 + rys * x1 * x1;
            double factor = denominator == 0 ? 0 : Math.Sqrt(Math.Max(0, numerator / denominator));
            if (largeArc == sweep) factor = -factor;
            double cx1 = factor * rx * y1 / ry;
            double cy1 = -factor * ry * x1 / rx;
            double cx = cosPhi * cx1 - sinPhi * cy1 + (start.x + end.x) / 2.0;
            double cy = sinPhi * cx1 + cosPhi * cy1 + (start.y + end.y) / 2.0;

            double theta1 = Angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
            double delta = Angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
            if (!sweep && delta > 0) delta -= 2 * Math.PI;
            else if (sweep && delta < 0) delta += 2 * Math.PI;

            int parts = Math.Max(1, (int)Math.Ceiling(Math.Abs(delta) / (Math.PI / 2) - 1e-9));
            double step = delta / parts;
            double kappa = 4.0 / 3.0 * Math.Tan(step / 4);
            double theta = theta1;
            for (int index = 0; index < parts; index++)
            {
                double cos1 = Math.Cos(theta);
                double sin1 = Math.Sin(theta);
                double theta2 = theta + step;
                double cos2 = Math.Cos(theta2);
                double sin2 = Math.Sin(theta2);

                Vector2 p1 = Map(cos1 - kappa * sin1, sin1 + kappa * cos1);
                Vector2 p2 = Map(cos2 + kappa * sin2, sin2 - kappa * cos2);
                Vector2 p3 = index == parts - 1 ? end : Map(cos2, sin2);
                into.Add(new Segment(p1, p2, p3, true));
                theta = theta2;
            }

            Vector2 Map(double ux, double uy)
            {
                double x = rx * ux;
                double y = ry * uy;
                return new Vector2((float)(cosPhi * x - sinPhi * y + cx), (float)(sinPhi * x + cosPhi * y + cy));
            }
        }

        private static double Angle(double ux, double uy, double vx, double vy)
        {
            double dot = ux * vx + uy * vy;
            double length = Math.Sqrt(ux * ux + uy * uy) * Math.Sqrt(vx * vx + vy * vy);
            double angle = Math.Acos(Math.Max(-1, Math.Min(1, dot / length)));
            return ux * vy - uy * vx < 0 ? -angle : angle;
        }

        private sealed class Reader
        {
            private readonly string text;
            private int position;

            public Reader(string text) => this.text = text;

            public bool AtEnd => position >= text.Length;

            public void SkipSeparators()
            {
                while (position < text.Length && (char.IsWhiteSpace(text[position]) || text[position] == ',')) position++;
            }

            public bool PeekCommand(out char command)
            {
                command = text[position];
                if (!char.IsLetter(command) || command == 'e' || command == 'E') return false;
                position++;
                return true;
            }

            public Vector2 Point() => new Vector2(Number(), Number());

            public bool Flag()
            {
                SkipSeparators();
                char flag = text[position++];
                if (flag != '0' && flag != '1') throw new FormatException("bad arc flag");
                return flag == '1';
            }

            public float Number()
            {
                SkipSeparators();
                int begin = position;
                if (position < text.Length && (text[position] == '-' || text[position] == '+')) position++;
                bool dot = false;
                while (position < text.Length)
                {
                    char c = text[position];
                    if (char.IsDigit(c))
                    {
                        position++;
                    }
                    else if (c == '.' && !dot)
                    {
                        dot = true;
                        position++;
                    }
                    else if ((c == 'e' || c == 'E') && position > begin)
                    {
                        position++;
                        if (position < text.Length && (text[position] == '-' || text[position] == '+')) position++;
                    }
                    else
                    {
                        break;
                    }
                }
                if (position == begin) throw new FormatException($"expected a number at {begin}");
                return float.Parse(text.Substring(begin, position - begin), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }
}
