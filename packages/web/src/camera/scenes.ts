import type { SceneId } from './backgrounds';
import graphite from './scenes/graphite.jpg';
import graphiteThumb from './scenes/graphite-thumb.jpg';
import greenhouse from './scenes/greenhouse.jpg';
import greenhouseThumb from './scenes/greenhouse-thumb.jpg';
import library from './scenes/library.jpg';
import libraryThumb from './scenes/library-thumb.jpg';
import nightWindow from './scenes/night-window.jpg';
import nightWindowThumb from './scenes/night-window-thumb.jpg';
import tavern from './scenes/tavern.jpg';
import tavernThumb from './scenes/tavern-thumb.jpg';

/**
 * The scenes' pictures: the 1280x720 one the processor lays behind the person
 * and the small one the picker shows. Drawn by `scripts/camera-scenes/`, which
 * writes both; the build gives them addresses by their content.
 */
export const SCENE_PICTURES: Record<SceneId, { image: string; thumb: string }> = {
  graphite: { image: graphite, thumb: graphiteThumb },
  tavern: { image: tavern, thumb: tavernThumb },
  library: { image: library, thumb: libraryThumb },
  nightWindow: { image: nightWindow, thumb: nightWindowThumb },
  greenhouse: { image: greenhouse, thumb: greenhouseThumb },
};
