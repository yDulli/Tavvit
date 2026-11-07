import type { CSSProperties, ReactNode } from 'react';
import type { User } from '@backspace/shared';
import type { NameFont } from '@backspace/shared/src/decorations';
import type { CustomDecorationKind } from '@backspace/shared/src/customDecorations';
import type { EffectChoice, FrameChoice, NameEffectChoice, NameplateChoice } from '../../../../utils/decorations';
import { Avatar } from '../../../ui/Avatar';
import { DecoratedName, NameplateLayer, ProfileEffectLayer } from '../../../ui/Decorations';

/** The person as the previews draw them. */
export interface PreviewLook {
  user: User;
  name: string;
  banner: CSSProperties;
  colors: { a: string; b: string };
}

/** A design of one of the four kinds, Tavvit's or one someone made. */
export type DesignChoice = FrameChoice | EffectChoice | NameplateChoice | NameEffectChoice;

/**
 * A picture of what a design does, the same for Tavvit's designs and those people made: the
 * person's picture in a frame, their banner under an effect, their row over a nameplate, their
 * name in a style (in the typeface they chose). `tile` fits a design's tile; `large` is for
 * making one, at the sizes it is worn at: the frame on a profile and in a list, the effect over a
 * whole small profile card, the nameplate behind a row of a member list, the name as a profile
 * shows it.
 */
export function DesignPreview({ kind, design, look, font, size = 'tile' }: {
  kind: CustomDecorationKind;
  design: DesignChoice | null;
  look: PreviewLook;
  font: NameFont | null;
  size?: 'tile' | 'large';
}) {
  const avatarProps = { src: look.user.avatar, name: look.name, userId: look.user.homeUserId ?? look.user.id, user: look.user };
  const large = size === 'large';
  switch (kind) {
    case 'frame':
      if (!large) return <Avatar {...avatarProps} size={36} frame={design as FrameChoice | null} frameMotion="on" />;
      return (
        <span className="flex items-center gap-10">
          <Avatar {...avatarProps} size={80} frame={design as FrameChoice | null} frameMotion="on" />
          <Avatar {...avatarProps} size={32} frame={design as FrameChoice | null} frameMotion="on" />
        </span>
      );
    case 'effect':
      if (!large) {
        return (
          <span className="relative block h-full w-full overflow-hidden" style={{ ...look.banner, '--deco-scale': 0.5 } as CSSProperties}>
            <ProfileEffectLayer effect={design as EffectChoice | null} />
          </span>
        );
      }
      return (
        <span
          className="relative isolate block h-48 w-32 overflow-hidden rounded-lg border border-border-soft bg-surface-chat text-left"
          style={{ '--deco-scale': 0.6 } as CSSProperties}
        >
          <span className="block h-12" style={look.banner} />
          <span className="absolute left-2.5 top-7">
            <Avatar {...avatarProps} size={36} />
          </span>
          <span className="mt-6 block truncate px-2.5 text-ui font-semibold text-txt-primary">{look.name}</span>
          <span className="block truncate px-2.5 text-meta text-txt-tertiary">@{look.user.username}</span>
          <ProfileEffectLayer effect={design as EffectChoice | null} className="z-20" />
        </span>
      );
    case 'nameplate':
      return (
        <span
          className={large
            ? 'relative isolate flex h-12 w-72 items-center gap-2.5 overflow-hidden rounded-md bg-surface-channel px-3 text-left'
            : 'relative isolate flex h-full w-full items-center gap-2 bg-surface-channel px-2.5'}
        >
          <NameplateLayer nameplate={design as NameplateChoice | null} colors={look.colors} />
          <Avatar {...avatarProps} size={large ? 32 : 22} />
          <span className={`truncate font-medium text-txt-primary ${large ? 'text-ui' : 'text-meta'}`}>{look.name}</span>
        </span>
      );
    case 'name':
      return (
        <DecoratedName
          font={font}
          effect={design as NameEffectChoice | null}
          colors={look.colors}
          className={`truncate px-2 font-semibold text-txt-primary ${large ? 'text-title' : 'text-ui'}`}
        >
          {look.name}
        </DecoratedName>
      );
  }
}

/**
 * One design in a grid of them (the gallery, one's own): its preview, its name and a line under
 * it, chosen by a click like a design of Tavvit's, with its actions beside the name, where they
 * cover nothing of the preview.
 */
export function DesignTile({ selected, onSelect, preview, title, detail, actions }: {
  selected: boolean;
  onSelect: () => void;
  preview: ReactNode;
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`relative rounded-lg border p-2 transition-colors duration-100 ${
        selected ? 'border-accent-primary bg-accent-primary/[0.06]' : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover'
      }`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="block w-full text-left">
        <span className="mb-2 flex h-14 items-center justify-center overflow-hidden rounded-md bg-surface-input" aria-hidden="true">
          {preview}
        </span>
        <span className={`flex items-center gap-1.5 pl-0.5 ${actions ? 'pr-16' : 'pr-0.5'}`}>
          <span
            aria-hidden="true"
            className={`h-2 w-2 flex-shrink-0 rounded-full border ${selected ? 'border-accent-primary bg-accent-primary' : 'border-interactive-muted'}`}
          />
          <span className="min-w-0 truncate text-ui font-medium text-txt-primary" title={title}>{title}</span>
        </span>
        {detail && <span className={`mt-0.5 block truncate pl-0.5 text-meta text-txt-tertiary ${actions ? 'pr-16' : 'pr-0.5'}`}>{detail}</span>}
      </button>
      {actions && <div className="absolute bottom-2.5 right-2 flex gap-0.5">{actions}</div>}
    </div>
  );
}
