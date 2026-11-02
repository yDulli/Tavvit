import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Attachment } from '@backspace/shared';

vi.mock('./MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span> }));
vi.mock('./AttachmentRenderer', () => ({ AttachmentRenderer: ({ attachment }: { attachment: Attachment }) => <img alt={attachment.originalName} /> }));

import { MessageCards } from './MessageCards';

const attachment = (id: string, mimetype: string): Attachment => ({ id, messageId: 'm', filename: `${id}.bin`, originalName: `${id}.bin`, mimetype, size: 1, createdAt: 1 });

afterEach(cleanup);

describe('MessageCards', () => {
  it('shows what a card holds', () => {
    render(<MessageCards cards={[{ title: 'Build', text: 'All green', footer: 'CI', fields: [{ name: 'Tests', value: '12', inline: true }] }]} />);
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('All green')).toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('makes a link of a title that has an address, opening elsewhere and telling that site nothing', () => {
    render(<MessageCards cards={[{ title: 'Build', url: 'https://ci.example/1' }]} />);
    const link = screen.getByRole('link', { name: 'Build' });
    expect(link).toHaveAttribute('href', 'https://ci.example/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('colours the edge with the card\'s colour alone', () => {
    const { container } = render(<MessageCards cards={[{ title: 'A', color: '#34c77b' }, { title: 'B' }]} />);
    const [first, second] = Array.from(container.querySelectorAll('article'));
    expect(first).toHaveStyle({ borderLeftColor: '#34c77b' });
    expect(second?.getAttribute('style')).toBeNull();
  });

  it('shows a picture only from the message\'s own images', () => {
    render(
      <MessageCards
        cards={[{ title: 'A', imageAttachmentId: 'img' }, { title: 'B', imageAttachmentId: 'doc' }, { title: 'C', imageAttachmentId: 'missing' }]}
        attachments={[attachment('img', 'image/png'), attachment('doc', 'application/pdf')]}
      />,
    );
    expect(screen.getByAltText('img.bin')).toBeInTheDocument();
    expect(screen.queryByAltText('doc.bin')).toBeNull();
  });
});
