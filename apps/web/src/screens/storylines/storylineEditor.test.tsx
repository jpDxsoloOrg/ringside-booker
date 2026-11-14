import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { galleryMemberOptions } from '@/screens/dev-gallery/fixtures/storylines';
import { defaultSideFor, filterMemberOptions, MemberPicker } from './MemberPicker';
import type { ChosenMember } from './MemberPicker';
import { placeReasons } from './StorylineEditorSheet';

function Picker({ max }: { readonly max?: number }) {
  const [chosen, setChosen] = useState<readonly ChosenMember[]>([]);
  return (
    <MemberPicker
      options={galleryMemberOptions}
      chosen={chosen}
      onChange={setChosen}
      {...(max === undefined ? {} : { max })}
    />
  );
}

describe('MemberPicker', () => {
  it('starts each pick on the side their alignment suggests', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Picker />);
    await user.click(screen.getByRole('button', { name: 'Add Gallery Name Three' }));
    await user.click(screen.getByRole('button', { name: 'Add Gallery Name Thirteen' }));
    expect(
      within(screen.getByRole('group', { name: 'Side for Gallery Name Three' })).getByRole(
        'radio',
        { name: 'Heel' },
      ),
    ).toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'Side for Gallery Name Thirteen' })).getByRole(
        'radio',
        { name: 'Neutral' },
      ),
    ).toBeChecked();
    expect(screen.getByText('2 of 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Gallery Name Three' })).toBeDisabled();
  });

  it('stops adding at the limit and filters by name, ignoring case', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Picker max={1} />);
    await user.click(screen.getByRole('button', { name: 'Add Gallery Name One' }));
    expect(screen.getByRole('button', { name: 'Add Gallery Name Five' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove Gallery Name One' }));
    expect(screen.getByRole('button', { name: 'Add Gallery Name Five' })).toBeEnabled();
    await user.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'MANAGER');
    expect(screen.getAllByRole('button', { name: /^Add / })).toHaveLength(1);
  });

  it('maps every alignment to a side, and filters on any part of the name', () => {
    expect(defaultSideFor('face')).toBe('face');
    expect(defaultSideFor('heel')).toBe('heel');
    expect(defaultSideFor('tweener')).toBe('neutral');
    expect(
      filterMemberOptions(galleryMemberOptions, '  NAME TH ').map((option) => option.name),
    ).toEqual(['Gallery Name Three', 'Gallery Name Thirteen']);
  });
});

describe('placeReasons', () => {
  it('puts each refusal under its field and the rest above the footer', () => {
    const placed = placeReasons([
      { code: 'storylines.nameTaken', message: 'Taken.', field: 'name' },
      { code: 'storylines.memberNotEmployed', message: 'Gone.', field: 'members[1].personId' },
      { code: 'storylines.noMembers', message: 'Empty.', field: 'members' },
      { code: 'storylines.notYours', message: 'Not yours.' },
    ]);
    expect(placed.name).toBe('Taken.');
    expect(placed.members).toBe('Gone. Empty.');
    expect(placed.summary).toBeUndefined();
    expect(placed.general).toEqual(['Not yours.']);
  });
});
