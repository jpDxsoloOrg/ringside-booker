import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { ChamferPanel } from './ChamferPanel';

describe('ChamferPanel', () => {
  it('is a plain box by default, with its heading and body', () => {
    const { container } = render(
      <ChamferPanel title="Show forecast" kicker="Live sim">
        <p>Predicted score 74</p>
      </ChamferPanel>,
    );

    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Show forecast' })).toBeInTheDocument();
    expect(screen.getByText('Live sim')).toBeInTheDocument();
    expect(screen.getByText('Predicted score 74')).toBeInTheDocument();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('is a named region as a section', () => {
    render(
      <ChamferPanel as="section" title="Card flow" headingLevel={3} accent="data">
        <p>Body</p>
      </ChamferPanel>,
    );

    const region = screen.getByRole('region', { name: 'Card flow' });
    expect(within(region).getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(region).toHaveAttribute('data-accent', 'data');
  });

  it('is an article named by its title', () => {
    render(
      <ChamferPanel as="article" title="Segment audit">
        <p>Body</p>
      </ChamferPanel>,
    );
    expect(screen.getByRole('article', { name: 'Segment audit' })).toBeInTheDocument();
  });

  it('has no header without a title, kicker or actions', () => {
    const { container } = render(
      <ChamferPanel surface="raised" padding="none">
        <p>Just content</p>
      </ChamferPanel>,
    );
    expect(container.querySelector('.header')).toBeNull();
    expect(container.querySelector('.surface-raised')).not.toBeNull();
    expect(container.querySelector('.padding-none')).not.toBeNull();
  });

  it('puts actions in the header', () => {
    render(
      <ChamferPanel title="Forecast" actions={<button type="button">Refresh</button>}>
        <p>Body</p>
      </ChamferPanel>,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('has no motion, so reduced motion renders it the same', () => {
    const withoutIds = (html: string) => html.replace(/:r[0-9a-z]+:/g, 'id');
    const { container: withMotion } = render(<ChamferPanel title="A">Body</ChamferPanel>);
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(<ChamferPanel title="A">Body</ChamferPanel>);
    expect(withoutIds(reduced.innerHTML)).toBe(withoutIds(withMotion.innerHTML));
  });
});
