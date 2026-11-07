import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProfileLinkedAccount } from '@backspace/shared';
import { ProfileLinks } from './ProfileLinks';

// A profile from another instance carries whatever that instance sent, so the
// card checks every link again (auth.md, "Profile fields"): only a plain web
// address becomes a link, and it opens in a new tab without an opener.

describe('ProfileLinks', () => {
  it('shows plain web addresses as links, by label or host', () => {
    render(<ProfileLinks variant="list" links={[
      { url: 'https://example.com/me', label: 'Portfolio' },
      { url: 'https://www.example.org/x', label: null },
    ]} />);
    const portfolio = screen.getByRole('link', { name: 'Portfolio' });
    expect(portfolio).toHaveAttribute('href', 'https://example.com/me');
    expect(portfolio).toHaveAttribute('target', '_blank');
    expect(portfolio.getAttribute('rel')).toContain('noopener');
    expect(portfolio.getAttribute('rel')).toContain('noreferrer');
    expect(screen.getByRole('link', { name: 'example.org' })).toHaveAttribute('href', 'https://www.example.org/x');
  });

  it('leaves out what is not a plain web address and keeps the rest', () => {
    render(<ProfileLinks variant="chips" links={[
      { url: 'javascript:alert(1)', label: 'Click' },
      { url: 'https://user:pass@example.com', label: 'Creds' },
      { url: 'https://example.com', label: `a${String.fromCharCode(0x202e)}b` },
      { url: 'https://example.net', label: 'Fine' },
    ]} />);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Fine']);
  });

  it('renders nothing without a link to show', () => {
    const { container } = render(<ProfileLinks variant="chips" links={[{ url: 'data:text/html,hi' }]} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<ProfileLinks variant="list" links={undefined} />);
    expect(none.container).toBeEmptyDOMElement();
    const neither = render(<ProfileLinks variant="chips" links={[]} linkedAccounts={[]} />);
    expect(neither.container).toBeEmptyDOMElement();
  });
});

// The accounts elsewhere the owner linked by signing in there come first,
// marked as linked (docs/systems/linked-accounts.md).
describe('ProfileLinks with linked accounts', () => {
  const twitch: ProfileLinkedAccount = { provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays' };

  it('shows a linked account first, marked as linked, leading to its own page', () => {
    render(<ProfileLinks variant="chips" links={[{ url: 'https://example.com/', label: 'Blog' }]} linkedAccounts={[twitch]} />);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAccessibleName('Twitch: Mara_Plays, linked account');
    expect(links[0]).toHaveAttribute('href', 'https://www.twitch.tv/mara_plays');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(links[1]).toHaveTextContent('Blog');
  });

  it('leaves out a linked account no service would name, and a typed link to the same page', () => {
    render(
      <ProfileLinks
        variant="list"
        links={[{ url: 'https://www.twitch.tv/mara_plays', label: null }]}
        linkedAccounts={[twitch, { provider: 'twitch', login: '../evil', name: 'x' }]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows a linked account alone, without typed links', () => {
    render(<ProfileLinks variant="list" links={undefined} linkedAccounts={[twitch]} />);
    expect(screen.getByRole('link', { name: 'Twitch: Mara_Plays, linked account' })).toBeInTheDocument();
  });
});
