import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const storage = vi.fn();
vi.mock('../../../api/client', () => ({ api: { users: { storage: () => storage() } } }));

import { StorageSection } from './StorageSection';

const GB = 1024 ** 3;

afterEach(() => {
  cleanup();
  storage.mockReset();
});

describe('StorageSection', () => {
  it('says how much of the limit is used, with a bar', async () => {
    storage.mockResolvedValue({ usedBytes: 2 * GB, limitBytes: 8 * GB });
    render(<StorageSection />);
    expect(await screen.findByText('2 GB of 8 GB used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('warns near the limit', async () => {
    storage.mockResolvedValue({ usedBytes: 95, limitBytes: 100 });
    render(<StorageSection />);
    const bar = await screen.findByRole('progressbar');
    expect(bar.firstElementChild?.className).toContain('bg-accent-amber');
  });

  it('never fills the bar past its end when a limit was lowered', async () => {
    storage.mockResolvedValue({ usedBytes: 300, limitBytes: 100 });
    render(<StorageSection />);
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows no bar without a limit', async () => {
    storage.mockResolvedValue({ usedBytes: 2 * GB, limitBytes: null });
    render(<StorageSection />);
    expect(await screen.findByText('2 GB used')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('stays away when the figure cannot be read', async () => {
    storage.mockRejectedValue(new Error('no'));
    const { container } = render(<StorageSection />);
    await vi.waitFor(() => expect(storage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
