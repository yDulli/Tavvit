import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  });
});
