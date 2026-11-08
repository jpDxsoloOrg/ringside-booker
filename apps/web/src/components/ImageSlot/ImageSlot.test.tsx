import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageSlot, forgetFailedImageUrls } from './ImageSlot';
import { monogramFor } from './placeholders/LogoMark';
import { registerImageResolver } from './resolver';
import type { ImageKind, ImageSubject } from './types';

const worker: ImageSubject = { kind: 'person', id: 'per_000001', name: 'Marlo Quint' };

const cleanups: (() => void)[] = [];

afterEach(() => {
  // Unmount first, so removing resolvers does not update slots that are still on screen.
  cleanup();
  for (const unregister of cleanups.splice(0)) unregister();
  forgetFailedImageUrls();
});

function useResolver(resolver: (subject: ImageSubject) => string | null): void {
  cleanups.push(registerImageResolver(resolver));
}

function renderMarkup(subject: ImageSubject, personStyle?: 'initials' | 'silhouette'): string {
  const { container, unmount } = render(
    <ImageSlot subject={subject} size="md" {...(personStyle ? { personStyle } : {})} />,
  );
  const markup = container.innerHTML;
  unmount();
  return markup;
}

describe('ImageSlot placeholders', () => {
  it('renders identical markup for the same subject', () => {
    const first = renderMarkup(worker);
    const second = renderMarkup({ ...worker });
    expect(second).toBe(first);
    expect(first).toMatchSnapshot();
  });

  it('draws different art for different ids', () => {
    const markups = new Set(
      Array.from({ length: 12 }, (_, index) =>
        renderMarkup({ ...worker, id: `per_${String(index).padStart(6, '0')}` }),
      ),
    );
    expect(markups.size).toBeGreaterThan(1);
  });

  it('keeps the colour when a person is renamed', () => {
    const before = renderMarkup(worker);
    const after = renderMarkup({ ...worker, name: 'Marlo Quint-Ash' });
    const tintOf = (markup: string) => /<g class="(tint\d)"/.exec(markup)?.[1];
    expect(tintOf(after)).toBe(tintOf(before));
    expect(tintOf(before)).toMatch(/^tint[1-8]$/);
  });

  it.each<[ImageKind, RegExp]>([
    ['person', /^person-initials$/],
    ['title', /^belt-(oval|shield|hexagon|circle)$/],
    ['promotion', /^logo-/],
    ['brand', /^logo-/],
    ['event', /^logo-/],
    ['network', /^logo-/],
    ['venue', /^place$/],
  ])('draws a %s placeholder', (kind, generator) => {
    render(<ImageSlot subject={{ kind, id: `${kind}_1`, name: 'Harbour Lights' }} size="md" />);
    const art = screen.getByRole('img', { name: 'Harbour Lights' });
    expect(art.tagName.toLowerCase()).toBe('svg');
    expect(art.getAttribute('data-placeholder')).toMatch(generator);
  });

  it('falls back to the generic place for a kind it does not know', () => {
    // Data from a newer pack can carry a kind this build has no generator for.
    const unknownKind: ImageSubject = { ...worker, id: 'stb_1', name: 'Iron Choir' };
    Reflect.set(unknownKind, 'kind', 'stable');
    render(<ImageSlot subject={unknownKind} size="sm" />);
    expect(screen.getByRole('img', { name: 'Iron Choir' })).toHaveAttribute(
      'data-placeholder',
      'place',
    );
  });

  it('draws people as ringed initials: a ring and initials in one tint on the raised surface', () => {
    const { container } = render(<ImageSlot subject={worker} size="md" />);
    const art = container.querySelector('svg[data-placeholder="person-initials"]');
    expect(art?.querySelector(':scope > rect')).toHaveClass('ringBackground');
    const tint = art?.querySelector(':scope > g');
    expect(tint?.getAttribute('class')).toMatch(/^tint[1-8]$/);
    expect(tint?.querySelector('circle')).toHaveClass('ring');
    expect(tint?.querySelector('text')).toHaveClass('ringLettering');
    expect(tint?.querySelector('text')).toHaveTextContent('MQ');
  });

  it('does not squeeze ordinary initials in the condensed face', () => {
    const { container } = render(<ImageSlot subject={worker} size="xs" />);
    expect(container.querySelector('text')).not.toHaveAttribute('textLength');
  });

  it('draws the ring as a rounded square in a square frame', () => {
    const { container } = render(<ImageSlot subject={worker} size="md" shape="square" />);
    const ring = container.querySelector('.ring');
    expect(ring?.tagName.toLowerCase()).toBe('rect');
    expect(container.querySelector('circle')).toBeNull();
  });

  it('draws silhouettes when asked', () => {
    const markup = renderMarkup(worker, 'silhouette');
    expect(markup).toMatch(/data-placeholder="person-silhouette-(short-hair|long-hair|hooded)"/);
  });

  it('defaults people to a circle frame and others to a square', () => {
    const { container } = render(
      <>
        <ImageSlot subject={worker} size="sm" />
        <ImageSlot subject={{ kind: 'title', id: 'tit_1', name: 'Coastal Crown' }} size="sm" />
        <ImageSlot subject={worker} size="sm" shape="square" />
      </>,
    );
    const frames = Array.from(container.querySelectorAll('[data-kind]'));
    expect(frames.map((frame) => frame.className)).toEqual([
      'slot sm circle',
      'slot sm square',
      'slot sm square',
    ]);
  });

  it.each([
    ['gold', 'metalGold'],
    ['silver', 'metalSilver'],
    ['bronze', 'metalBronze'],
    ['plain', 'metalPlain'],
    [undefined, 'metalPlain'],
  ] as const)('paints a %s belt in the %s metal', (tier, metalClass) => {
    const title: ImageSubject = {
      kind: 'title',
      id: 'tit_000009',
      name: 'Coastal Crown',
      ...(tier === undefined ? {} : { tier }),
    };
    const { container } = render(<ImageSlot subject={title} size="md" />);
    const metalClasses = new Set(
      Array.from(container.querySelectorAll('svg [class^="metal"]'), (node) =>
        node.getAttribute('class'),
      ),
    );
    expect([...metalClasses]).toEqual([metalClass]);
  });

  it('never gives a logo mark the same outer and inner colour', () => {
    for (let index = 0; index < 200; index += 1) {
      const { container, unmount } = render(
        <ImageSlot
          subject={{ kind: 'promotion', id: `pro_${String(index)}`, name: 'X' }}
          size="sm"
        />,
      );
      const outer = container.querySelector('svg > [class^="cat"]')?.getAttribute('class');
      const inner = container.querySelector('svg > g > [class^="cat"]')?.getAttribute('class');
      expect(outer).toMatch(/^cat[1-8]$/);
      expect(inner).toMatch(/^cat[1-8]$/);
      expect(inner).not.toBe(outer);
      unmount();
    }
  });

  it('separates the face from the hair in every silhouette variant', () => {
    const variants = new Set<string>();
    for (let index = 0; index < 60; index += 1) {
      const markup = renderMarkup({ ...worker, id: `per_${String(index)}` }, 'silhouette');
      const variant = /data-placeholder="person-silhouette-([a-z-]+)"/.exec(markup)?.[1];
      if (variant === undefined) throw new Error('No silhouette drawn.');
      variants.add(variant);
      if (variant !== 'short-hair') {
        // Long hair and hoods draw the face over a ring in the background colour.
        expect(markup).toMatch(/<ellipse[^>]*class="cat[1-8]"/);
      }
    }
    expect([...variants].sort()).toEqual(['hooded', 'long-hair', 'short-hair']);
  });

  it('never makes a network request for a placeholder', () => {
    const { container } = render(<ImageSlot subject={worker} size="lg" />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ImageSlot with a resolver', () => {
  it('renders the resolved URL as a lazy image', () => {
    useResolver((subject) => `/art/${subject.id}.webp`);
    render(<ImageSlot subject={worker} size="md" />);
    const image = screen.getByRole('img', { name: 'Marlo Quint' });
    expect(image.tagName.toLowerCase()).toBe('img');
    expect(image).toHaveAttribute('src', '/art/per_000001.webp');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('width', '48');
    expect(image).toHaveAttribute('height', '48');
  });

  it('swaps to the placeholder when the image fails to load, and remembers the failure', () => {
    useResolver(() => '/art/missing.webp');
    const { unmount } = render(<ImageSlot subject={worker} size="md" />);
    fireEvent.error(screen.getByRole('img', { name: 'Marlo Quint' }));
    expect(screen.getByRole('img', { name: 'Marlo Quint' }).tagName.toLowerCase()).toBe('svg');
    unmount();

    // A fresh slot for the same URL goes straight to the placeholder.
    render(<ImageSlot subject={worker} size="sm" />);
    expect(screen.getByRole('img', { name: 'Marlo Quint' }).tagName.toLowerCase()).toBe('svg');
  });

  it('picks up a resolver registered after the slot rendered', () => {
    render(<ImageSlot subject={worker} size="md" />);
    expect(screen.getByRole('img', { name: 'Marlo Quint' }).tagName.toLowerCase()).toBe('svg');
    act(() => {
      useResolver(() => '/art/late.webp');
    });
    expect(screen.getByRole('img', { name: 'Marlo Quint' })).toHaveAttribute(
      'src',
      '/art/late.webp',
    );
    act(() => {
      for (const unregister of cleanups.splice(0)) unregister();
    });
    expect(screen.getByRole('img', { name: 'Marlo Quint' }).tagName.toLowerCase()).toBe('svg');
  });
});

describe('ImageSlot accessibility', () => {
  it('names the art after the entity', () => {
    render(<ImageSlot subject={worker} size="md" />);
    expect(screen.getByRole('img', { name: 'Marlo Quint' })).toBeInTheDocument();
  });

  it('hides decorative placeholders from the accessibility tree', () => {
    const { container } = render(<ImageSlot subject={worker} size="md" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives decorative images an empty alt', () => {
    useResolver(() => '/art/decorative.webp');
    const { container } = render(<ImageSlot subject={worker} size="md" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('monogramFor', () => {
  it.each([
    [{ name: 'Pacific Coast Grappling', shortName: 'pcg' }, 'PCG'],
    [{ name: 'Harbour Lights Wrestling', shortName: 'HLWX' }, 'HLW'],
    [{ name: 'Harbour Lights Wrestling', shortName: 'Harbour Lights' }, 'HL'],
    [{ name: 'Pacific Coast Grappling Alliance' }, 'PCA'],
    [{ name: 'Nightfall' }, 'NI'],
  ])('%o → %s', (subject, expected) => {
    expect(monogramFor(subject)).toBe(expected);
  });
});
