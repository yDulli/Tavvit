import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NameFont } from '@backspace/shared/src/decorations';
import {
  CUSTOM_DECORATION_LIMITS,
  CUSTOM_DECORATION_TEMPLATE,
  EFFECT_MOTIONS,
  NAME_STYLE_COLORS,
  NAME_STYLE_LOOKS,
  normalizeDecorationName,
  type CustomDecoration,
  type CustomDecorationKind,
  type CustomDecorationView,
  type EffectMotion,
  type NameStyle,
  type NameStyleLook,
} from '@backspace/shared/src/customDecorations';
import { api } from '../../../../api/client';
import { describeError } from '../../../../i18n/errors';
import { Modal } from '../../../ui/Modal';
import { Icon } from '../../../ui/Icon';
import { FormError, OptionCards } from '../_shared/SettingsControls';
import { DesignPreview, type PreviewLook } from './DesignPreview';

/** What a picture may be before it is sent; the server checks again and re-encodes it. */
const PICTURE_TYPES = ['image/png', 'image/webp', 'image/gif'];
const MAX_MB = CUSTOM_DECORATION_LIMITS.MAX_BYTES / (1024 * 1024);

/** Colours a name style may start from where the person's own run out: lavender, peach, sky, mint. */
const SPARE_COLORS = ['#a596ef', '#f2a65a', '#60a5e6', '#5cc491'];

/**
 * The colours a name style starts from: the person's own, three that differ from each other (a
 * person whose two colours are one gets a spare for the second), the last of them white.
 */
function startingColors(look: PreviewLook): string[] {
  const hex = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);
  const own = [hex(look.colors.a), hex(look.colors.b)].filter((color): color is string => color !== null);
  const chosen: string[] = [];
  for (const color of [...own, ...SPARE_COLORS]) {
    if (chosen.length === 2) break;
    if (!chosen.includes(color)) chosen.push(color);
  }
  return [...chosen, '#ffffff'];
}

/**
 * A picture read for sending and for the preview, as one data address: the preview draws it as it
 * is (the dialog's exit copy too, which a revoked address of the browser's own would leave empty),
 * and what is sent is the part after its comma.
 */
interface ChosenPicture {
  dataUrl: string;
}

/**
 * Making a decoration (docs/systems/decorations.md, "Made by people"): a frame or a nameplate from
 * a picture the person chooses, an effect from a small piece and the motion it moves in, or a name
 * style from a look and colours; a name for it, and whether it goes into the community's gallery
 * straight away. Tried on in a preview before it is sent.
 */
export function CreateDecorationDialog({ kind, look, font, onClose, onCreated }: {
  kind: CustomDecorationKind;
  look: PreviewLook;
  font: NameFont | null;
  onClose: () => void;
  onCreated: (design: CustomDecoration) => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const nameId = useId();
  const pictureId = useId();
  const lookLabel = useId();
  const motionLabel = useId();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [picture, setPicture] = useState<ChosenPicture | null>(null);
  const [motion, setMotion] = useState<EffectMotion>('fall');
  const [nameLook, setNameLook] = useState<NameStyleLook>('gradient');
  const [colors, setColors] = useState<string[]>(() => startingColors(look));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isPicture = kind !== 'name';

  const range = NAME_STYLE_COLORS[nameLook];
  const style: NameStyle = { look: nameLook, colors: colors.slice(0, range.max) };
  /** The chosen piece in one motion, as the motion's card and the preview draw it. */
  const pieceIn = (dataUrl: string, moving: EffectMotion): CustomDecorationView => (
    { id: '0', kind: 'effect', name, image: dataUrl, still: null, style: null, motion: moving }
  );
  const trying: CustomDecorationView | null = isPicture
    ? picture
      ? kind === 'effect' ? pieceIn(picture.dataUrl, motion) : { id: '0', kind, name, image: picture.dataUrl, still: null, style: null, motion: null }
      : null
    : { id: '0', kind, name, image: null, still: null, style, motion: null };

  const choosePicture = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!PICTURE_TYPES.includes(file.type) || file.size > CUSTOM_DECORATION_LIMITS.MAX_BYTES) {
      setError(t('settings:decorations.made.pictureInvalid', { max: MAX_MB }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:image/')) {
        setError(t('settings:decorations.made.pictureInvalid', { max: MAX_MB }));
        return;
      }
      setPicture({ dataUrl });
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').slice(0, CUSTOM_DECORATION_LIMITS.NAME_MAX));
    };
    reader.onerror = () => setError(t('settings:decorations.made.pictureInvalid', { max: MAX_MB }));
    reader.readAsDataURL(file);
  };

  const validName = normalizeDecorationName(name) !== undefined;
  const ready = validName && (!isPicture || picture !== null) && !saving;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const design = await api.decorations.create({
        kind,
        name: name.trim(),
        ...(isPicture ? { image: picture!.dataUrl.slice(picture!.dataUrl.indexOf(',') + 1) } : { style }),
        ...(kind === 'effect' ? { motion } : {}),
        shared,
      });
      onCreated(design);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const template = isPicture ? CUSTOM_DECORATION_TEMPLATE[kind] : null;

  return (
    <Modal isOpen onClose={onClose} title={t(`settings:decorations.made.createTitle.${kind}`)} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-lg border border-border-hard bg-surface-input px-4 py-5">
          {trying
            ? <DesignPreview kind={kind} design={trying} look={look} font={font} size="large" />
            : <span className="text-meta text-txt-tertiary">{t('settings:decorations.made.noPicture')}</span>}
        </div>

        {isPicture && template && (
          <div className="space-y-1.5">
            <label htmlFor={pictureId} className="field-label">{t('settings:decorations.made.picture')}</label>
            <label htmlFor={pictureId} className="btn-outline btn-sm w-full cursor-pointer">
              <Icon name="upload" size={14} />
              {picture ? t('settings:decorations.made.pictureOther') : t('settings:decorations.made.pictureChoose')}
            </label>
            <input
              id={pictureId}
              type="file"
              accept={PICTURE_TYPES.join(',')}
              className="sr-only"
              onChange={(event) => choosePicture(event.target.files?.[0])}
            />
            <p className="text-meta leading-snug text-txt-tertiary">
              {t(`settings:decorations.made.template.${kind}`, { width: template.width, height: template.height, max: MAX_MB })}
            </p>
          </div>
        )}

        {kind === 'effect' && (
          <div className="space-y-1.5">
            <div id={motionLabel} className="field-label">{t('settings:decorations.made.motion')}</div>
            <OptionCards
              labelledBy={motionLabel}
              value={motion}
              onChange={setMotion}
              columns={3}
              options={EFFECT_MOTIONS.map((id) => ({
                id,
                label: t(`settings:decorations.made.motions.${id}`),
                preview: picture ? <DesignPreview kind="effect" design={pieceIn(picture.dataUrl, id)} look={look} font={font} /> : undefined,
              }))}
            />
          </div>
        )}

        {!isPicture && (
          <>
            <div className="space-y-1.5">
              <div id={lookLabel} className="field-label">{t('settings:decorations.made.look')}</div>
              <OptionCards
                labelledBy={lookLabel}
                value={nameLook}
                onChange={setNameLook}
                columns={4}
                options={NAME_STYLE_LOOKS.map((id) => ({
                  id,
                  label: t(`settings:decorations.made.looks.${id}`),
                  preview: (
                    <DesignPreview
                      kind="name"
                      design={{ id: '0', kind: 'name', name: '', image: null, still: null, style: { look: id, colors: colors.slice(0, NAME_STYLE_COLORS[id].max) }, motion: null }}
                      look={look}
                      font={font}
                    />
                  ),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <div className="field-label">{t('settings:decorations.made.colors')}</div>
              <div className="flex gap-2">
                {colors.slice(0, range.max).map((color, index) => (
                  <input
                    key={index}
                    type="color"
                    value={color}
                    aria-label={t('settings:decorations.made.colorNumber', { number: index + 1 })}
                    onChange={(event) => setColors((current) => current.map((value, at) => (at === index ? event.target.value.toLowerCase() : value)))}
                    className="h-9 w-12 cursor-pointer rounded-md border border-border-soft bg-surface-input p-1"
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label htmlFor={nameId} className="field-label">{t('settings:decorations.made.name')}</label>
          <input
            id={nameId}
            type="text"
            value={name}
            maxLength={CUSTOM_DECORATION_LIMITS.NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className="input-standard w-full"
          />
        </div>

        <label className="flex items-start gap-2.5 text-ui text-txt-secondary">
          <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} className="mt-0.5" />
          <span>
            <span className="block text-txt-primary">{t('settings:decorations.made.shareLabel')}</span>
            <span className="block text-meta text-txt-tertiary">{t('settings:decorations.made.shareHint')}</span>
          </span>
        </label>

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="button" onClick={save} disabled={!ready} aria-busy={saving} className="btn-primary">
            {saving ? t('common:states.saving') : t('settings:decorations.made.create')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
