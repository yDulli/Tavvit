import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../i18n';
import { SESSION_TOKEN_KEY } from '../landing/entry';
import { NotFoundPage } from './NotFoundPage';

function renderPage() {
  render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
}

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('NotFoundPage', () => {
  it('leads a visitor to the product page', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'To the home page' })).toHaveAttribute('href', '/');
  });

  it('leads someone signed in back to the app', () => {
    window.localStorage.setItem(SESSION_TOKEN_KEY, 'token');
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to the app' })).toHaveAttribute('href', '/channels/@me');
  });
});
