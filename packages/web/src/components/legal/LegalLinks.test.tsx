import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceInfoResponse } from '@backspace/shared';
import { initI18n } from '../../i18n';
import { LegalLinks } from './LegalLinks';

const info = vi.hoisted(() => ({ value: null as InstanceInfoResponse | null }));
vi.mock('../../hooks/useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => info.value }));

function renderLinks() {
  render(<MemoryRouter><LegalLinks /></MemoryRouter>);
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  info.value = null;
});

describe('LegalLinks', () => {
  it('offers the source of what runs here as one plain word, per AGPL section 13', () => {
    info.value = { sourceCodeUrl: 'https://tavvit.com/downloads/source/tavvit-1.15.0-abc.tar.gz' } as InstanceInfoResponse;
    renderLinks();
    const link = screen.getByRole('link', { name: 'Source code' });
    expect(link).toHaveAttribute('href', 'https://tavvit.com/downloads/source/tavvit-1.15.0-abc.tar.gz');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('names neither the licence nor a version', () => {
    info.value = { sourceCodeUrl: 'https://example.org/source', version: '1.15.0', commit: 'abc1234' } as InstanceInfoResponse;
    renderLinks();
    expect(screen.queryByText(/AGPL|1\.15\.0|abc1234/)).toBeNull();
  });

  it('keeps the legal pages while the server has not answered', () => {
    renderLinks();
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Source code' })).toBeNull();
  });
});
