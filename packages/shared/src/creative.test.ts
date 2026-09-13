import { describe, expect, it } from 'vitest';
import { isCreativeImageRef, resolveCreativeImageUrl } from './creative';

describe('isCreativeImageRef', () => {
  it('accepts artwork the advertiser hosts', () => {
    expect(isCreativeImageRef('https://cdn.example.com/banner.png')).toBe(true);
    expect(isCreativeImageRef('http://localhost:3000/creatives/art.svg')).toBe(true);
  });

  it('accepts a root-relative path to artwork we host', () => {
    expect(isCreativeImageRef('/creatives/brands/vercel-wide.svg')).toBe(true);
  });

  it('rejects a protocol-relative path, which has no origin to resolve against', () => {
    expect(isCreativeImageRef('//cdn.example.com/banner.png')).toBe(false);
  });

  it('rejects anything that is neither', () => {
    expect(isCreativeImageRef('creatives/art.svg')).toBe(false);
    expect(isCreativeImageRef('javascript:alert(1)')).toBe(false);
    expect(isCreativeImageRef('')).toBe(false);
  });
});

describe('resolveCreativeImageUrl', () => {
  it('pins a relative creative to the origin serving the impression', () => {
    expect(resolveCreativeImageUrl('/creatives/brands/neon.svg', 'https://grape.example.com')).toBe(
      'https://grape.example.com/creatives/brands/neon.svg',
    );
  });

  it('leaves an advertiser-hosted URL on its own origin', () => {
    expect(
      resolveCreativeImageUrl('https://cdn.example.com/a.png', 'https://grape.example.com'),
    ).toBe('https://cdn.example.com/a.png');
  });

  it('is null for a creative with no artwork, so the card draws the monogram', () => {
    expect(resolveCreativeImageUrl(null, 'https://grape.example.com')).toBeNull();
    expect(resolveCreativeImageUrl(undefined, 'https://grape.example.com')).toBeNull();
    expect(resolveCreativeImageUrl('', 'https://grape.example.com')).toBeNull();
  });

  it('is null rather than throwing when the stored value is junk', () => {
    expect(resolveCreativeImageUrl('/ok.svg', 'not-an-origin')).toBeNull();
  });
});
