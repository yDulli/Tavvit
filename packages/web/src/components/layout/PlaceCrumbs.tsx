import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSpaceStore } from '../../stores/spaceStore';
import { HOME_ROUTES as HOME } from '../../utils/homeNav';
import { instanceCrumb } from './AppTopbar';
import { SpaceGlyph } from './SpaceSidebar';
import { Crumb, CrumbSep } from './TopbarSlots';

/**
 * The first steps of a breadcrumb in a space: the instance the space lives on (its host, in mono,
 * a way back to Home) and the space itself with its glyph.
 */
export function SpaceCrumbs({ spaceId }: { spaceId: string | null }) {
  const navigate = useNavigate();
  const space = useSpaceStore((s) => s.spaces.find((candidate) => candidate.id === spaceId));
  let host = instanceCrumb();
  if (space?._instanceOrigin) {
    try { host = new URL(space._instanceOrigin).host; } catch { /* keep the home host */ }
  }
  return (
    <>
      <Crumb mono onClick={() => navigate(HOME.home)}>{host}</Crumb>
      {space && (
        <>
          <CrumbSep />
          <span className="flex min-w-0 flex-shrink items-center gap-2">
            <SpaceGlyph id={space.id} name={space.name} icon={space.icon} avatarColor={space.avatarColor} size={18} />
            <span className="truncate text-ui text-txt-secondary">{space.name}</span>
          </span>
        </>
      )}
      <CrumbSep />
    </>
  );
}

/** The first steps of a breadcrumb in a conversation: the instance and the direct messages. */
export function DmCrumbs() {
  const { t } = useTranslation('spaces');
  const navigate = useNavigate();
  return (
    <>
      <Crumb mono onClick={() => navigate(HOME.home)}>{instanceCrumb()}</Crumb>
      <CrumbSep />
      <Crumb onClick={() => navigate(HOME.home)}>{t('sidebar.directMessages')}</Crumb>
      <CrumbSep />
    </>
  );
}
