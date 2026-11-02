/**
 * Profile pictures and banners.
 *
 * A still image is cropped and shrunk in the browser. An animated one (a GIF or
 * an animated WebP) cannot be, because a canvas keeps a single frame, so the
 * browser sends the original and the crop to the server, which cuts every frame
 * and returns one animated WebP at the same size a still image would have.
 */

export const PROFILE_IMAGE_KINDS = ['avatar', 'banner'] as const;
export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];

export interface ProfileImageSpec {
  /** Output size in pixels. */
  width: number;
  height: number;
  /** The most the finished animated file may weigh. */
  maxBytes: number;
}

export const PROFILE_IMAGE_SPECS: Record<ProfileImageKind, ProfileImageSpec> = {
  avatar: { width: 256, height: 256, maxBytes: 1_500_000 },
  banner: { width: 1280, height: 427, maxBytes: 4_000_000 },
};

/** The largest original the server takes for cropping. */
export const MAX_PROFILE_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;

/** The most frames of the original the server will cut. */
export const MAX_PROFILE_IMAGE_FRAMES = 500;

/** A crop rectangle in the original's pixels. */
export interface ProfileImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProfileImageRequest {
  kind: ProfileImageKind;
  /** The original file, base64. */
  image: string;
  crop: ProfileImageCrop;
}

export interface ProfileImageResponse {
  /** The stored file, to send as `avatar` or `banner` in the profile update. */
  filename: string;
}

export function isProfileImageKind(value: unknown): value is ProfileImageKind {
  return typeof value === 'string' && (PROFILE_IMAGE_KINDS as readonly string[]).includes(value);
}
