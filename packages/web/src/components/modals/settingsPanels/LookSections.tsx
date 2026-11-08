import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import {
  AVATAR_SHAPES,
  CORNERS,
  DENSITIES,
  FONTS,
  MESSAGE_STYLES,
  SIDEBAR_WIDTHS,
  TIME_FORMATS,
} from '../../../utils/appearanceOptions';
import { OptionCards, SegmentedControl, SettingBlock, SettingsSection, ToggleRow } from './_shared/SettingsControls';
import { AvatarsPreview, CornersPreview, DensityPreview, FontPreview, MessageStylePreview } from './_shared/appearancePreviews';

/**
 * The look of the interface beyond its colours (Settings, Appearance): its
 * shape, how messages are drawn, the typeface, and what helps reading. Every
 * choice applies at once and is kept on this device (`appearanceStore`). Each
 * setting is its own block, so the theme studio (`studio/LookStudio.tsx`) shows
 * the ones a look holds and leaves out the person's own (the sidebar, the clock).
 */

export function CornersSetting() {
  const { t } = useTranslation('settings');
  const corners = useAppearanceStore((s) => s.corners);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.shape.corners.label')} description={t('appearance.shape.corners.description')}>
      {(labelId) => (
        <OptionCards
          labelledBy={labelId}
          value={corners}
          onChange={(value) => setLook({ corners: value })}
          options={CORNERS.map((id) => ({ id, label: t(`appearance.shape.corners.options.${id}`), preview: <CornersPreview corners={id} /> }))}
        />
      )}
    </SettingBlock>
  );
}

export function AvatarShapeSetting() {
  const { t } = useTranslation('settings');
  const avatarShape = useAppearanceStore((s) => s.avatarShape);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.shape.avatars.label')} description={t('appearance.shape.avatars.description')}>
      {(labelId) => (
        <OptionCards
          labelledBy={labelId}
          value={avatarShape}
          onChange={(value) => setLook({ avatarShape: value })}
          options={AVATAR_SHAPES.map((id) => ({ id, label: t(`appearance.shape.avatars.options.${id}`), preview: <AvatarsPreview shape={id} /> }))}
        />
      )}
    </SettingBlock>
  );
}

export function SidebarWidthSetting() {
  const { t } = useTranslation('settings');
  const sidebarWidth = useAppearanceStore((s) => s.sidebarWidth);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.shape.sidebar.label')} description={t('appearance.shape.sidebar.description')}>
      {(labelId) => (
        <SegmentedControl
          labelledBy={labelId}
          value={sidebarWidth}
          onChange={(value) => setLook({ sidebarWidth: value })}
          options={SIDEBAR_WIDTHS.map((id) => ({ id, label: t(`appearance.shape.sidebar.options.${id}`) }))}
        />
      )}
    </SettingBlock>
  );
}

export function MessageStyleSetting() {
  const { t } = useTranslation('settings');
  const messageStyle = useAppearanceStore((s) => s.messageStyle);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.messages.style.label')} description={t('appearance.messages.style.description')}>
      {(labelId) => (
        <OptionCards
          labelledBy={labelId}
          value={messageStyle}
          onChange={(value) => setLook({ messageStyle: value })}
          options={MESSAGE_STYLES.map((id) => ({
            id,
            label: t(`appearance.messages.style.options.${id}.label`),
            description: t(`appearance.messages.style.options.${id}.description`),
            preview: <MessageStylePreview style={id} />,
          }))}
        />
      )}
    </SettingBlock>
  );
}

export function DensitySetting() {
  const { t } = useTranslation('settings');
  const density = useAppearanceStore((s) => s.density);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.messages.density.label')} description={t('appearance.messages.density.description')}>
      {(labelId) => (
        <OptionCards
          labelledBy={labelId}
          value={density}
          onChange={(value) => setLook({ density: value })}
          options={DENSITIES.map((id) => ({ id, label: t(`appearance.messages.density.options.${id}`), preview: <DensityPreview density={id} /> }))}
        />
      )}
    </SettingBlock>
  );
}

export function ClockSetting() {
  const { t } = useTranslation('settings');
  const timeFormat = useAppearanceStore((s) => s.timeFormat);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.messages.clock.label')} description={t('appearance.messages.clock.description')}>
      {(labelId) => (
        <SegmentedControl
          labelledBy={labelId}
          value={timeFormat}
          onChange={(value) => setLook({ timeFormat: value })}
          options={TIME_FORMATS.map((id) => ({ id, label: t(`appearance.messages.clock.options.${id}`) }))}
        />
      )}
    </SettingBlock>
  );
}

export function FontSetting() {
  const { t } = useTranslation('settings');
  const font = useAppearanceStore((s) => s.font);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <SettingBlock label={t('appearance.typeface.label')} description={t('appearance.typeface.description')}>
      {(labelId) => (
        <OptionCards
          labelledBy={labelId}
          value={font}
          columns={3}
          onChange={(value) => setLook({ font: value })}
          options={FONTS.map((id) => ({ id, label: t(`appearance.typeface.options.${id}`), preview: <FontPreview font={id} /> }))}
        />
      )}
    </SettingBlock>
  );
}

/** Corners, profile pictures and the width of the sidebar. */
export function ShapeSection() {
  const { t } = useTranslation('settings');
  return (
    <SettingsSection title={t('appearance.shape.title')}>
      <CornersSetting />
      <AvatarShapeSetting />
      <SidebarWidthSetting />
    </SettingsSection>
  );
}

/** How messages are drawn, how close they sit, and the clock. */
export function MessagesSection() {
  const { t } = useTranslation('settings');
  return (
    <SettingsSection title={t('appearance.messages.title')}>
      <MessageStyleSetting />
      <DensitySetting />
      <ClockSetting />
    </SettingsSection>
  );
}

/** The typeface the whole app is set in. */
export function TypefaceSection() {
  const { t } = useTranslation('settings');
  return (
    <SettingsSection title={t('appearance.typeface.title')}>
      <FontSetting />
    </SettingsSection>
  );
}

/** Contrast and status colours that do not depend on telling red from green. */
export function AccessibilitySection() {
  const { t } = useTranslation('settings');
  const contrast = useAppearanceStore((s) => s.contrast);
  const statusPalette = useAppearanceStore((s) => s.statusPalette);
  const underlineLinks = useAppearanceStore((s) => s.underlineLinks);
  const setLook = useAppearanceStore((s) => s.setLook);

  return (
    <SettingsSection title={t('appearance.access.title')}>
      <ToggleRow
        label={t('appearance.access.contrast.label')}
        description={t('appearance.access.contrast.description')}
        enabled={contrast === 'high'}
        onChange={(value) => setLook({ contrast: value ? 'high' : 'standard' })}
      />
      <ToggleRow
        label={t('appearance.access.status.label')}
        description={t('appearance.access.status.description')}
        enabled={statusPalette === 'accessible'}
        onChange={(value) => setLook({ statusPalette: value ? 'accessible' : 'standard' })}
      />
      <ToggleRow
        label={t('appearance.messages.underlineLinks.label')}
        description={t('appearance.messages.underlineLinks.description')}
        enabled={underlineLinks}
        onChange={(value) => setLook({ underlineLinks: value })}
      />
    </SettingsSection>
  );
}

/** The light that falls on the panels in the colour of the place (design-system.md, "Light"). */
export function LightSetting() {
  const { t } = useTranslation('settings');
  const light = useAppearanceStore((s) => s.light);
  const setLook = useAppearanceStore((s) => s.setLook);
  return (
    <ToggleRow
      label={t('appearance.reading.light.label')}
      description={t('appearance.reading.light.description')}
      enabled={light === 'on'}
      onChange={(on) => setLook({ light: on ? 'on' : 'off' })}
    />
  );
}

/** Whether a space shows in the colours it chose for itself (`Space.look`) while one is in it. */
export function SpaceLooksSetting() {
  const { t } = useTranslation('settings');
  const spaceLooks = useAppearanceStore((s) => s.spaceLooks);
  const setSpaceLooks = useAppearanceStore((s) => s.setSpaceLooks);
  return (
    <ToggleRow
      label={t('appearance.spaceLooks.label')}
      description={t('appearance.spaceLooks.description')}
      enabled={spaceLooks}
      onChange={setSpaceLooks}
    />
  );
}
