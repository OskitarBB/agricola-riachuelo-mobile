// __tests__/pictureSize.test.ts — Resolución de captura (Q-15): la mayor ≤ capture.maxMegapixels, preferiblemente 4:3.
import { choosePictureSize, parsePictureSize } from '../src/domain/pictureSize';

describe('pictureSize', () => {
  it('interpreta "ANCHOxALTO" y descarta los presets de iOS', () => {
    expect(parsePictureSize('4000x3000')).toEqual({ value: '4000x3000', width: 4000, height: 3000, megapixels: 12 });
    expect(parsePictureSize('3000x4000')?.width).toBe(4000);
    expect(parsePictureSize('Photo')).toBeNull();
    expect(parsePictureSize('0x0')).toBeNull();
  });

  it('celular de 50 MP: elige 12 MP 4:3 y no la resolución máxima', () => {
    const sizes = ['8160x6144', '8160x4592', '4080x3072', '4080x2296', '3264x2448', '1920x1080', '640x480'];
    expect(choosePictureSize(sizes, 12)).toBe('4080x3072');
  });

  it('acepta 4032×3024 (12,19 MP) como 12 MP', () => {
    expect(choosePictureSize(['4032x3024', '4032x2268', '3024x3024'], 12)).toBe('4032x3024');
  });

  it('sin 4:3 dentro del límite usa el más grande de cualquier forma', () => {
    expect(choosePictureSize(['8000x6000', '3840x2160', '1920x1080'], 12)).toBe('3840x2160');
  });

  it('sin tamaños utilizables devuelve null (no se fija pictureSize)', () => {
    expect(choosePictureSize([], 12)).toBeNull();
    expect(choosePictureSize(['Photo', 'High'], 12)).toBeNull();
    expect(choosePictureSize(['9000x7000'], 12)).toBeNull();
  });
});
