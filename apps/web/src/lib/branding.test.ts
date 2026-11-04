import { describe, expect, it } from 'vitest';
import { NEUTRAL_BRANDING, type BrandingDto } from '@gps/shared';
import { brandVars, darken, slugFromLocation, tint } from './branding';

const brand = (over: Partial<BrandingDto> = {}): BrandingDto => ({ ...NEUTRAL_BRANDING, neutral: false, slug: 'acme', displayName: 'Acme', primaryColor: '#B00020', onPrimaryColor: '#FFFFFF', ...over });

describe('branding', () => {
  it('derives the brand variables from the provider colour, and none for the neutral brand', () => {
    const v = brandVars(brand());
    expect(v['--color-brand']).toBe('#B00020');
    expect(v['--color-brand-text']).toBe('#FFFFFF');
    expect(v['--color-brand-hover']).toMatch(/^#[0-9a-f]{6}$/);
    expect(brandVars(NEUTRAL_BRANDING)).toEqual({});
  });

  it('darkens and tints without leaving the colour range', () => {
    expect(darken('#FFFFFF', 0.5)).toBe('#808080');
    expect(darken('#000000', 0.5)).toBe('#000000');
    expect(tint('#000000', 1)).toBe('#ffffff');
    expect(tint('#102030', 0)).toBe('#102030');
  });

  it('reads the provider from ?brand= or from the first host label, never from "www" or "app"', () => {
    expect(slugFromLocation('?brand=Acme', 'localhost')).toBe('acme');
    expect(slugFromLocation('', 'acme.platform.example')).toBe('acme');
    expect(slugFromLocation('', 'www.platform.example')).toBeNull();
    expect(slugFromLocation('', 'localhost')).toBeNull();
    expect(slugFromLocation('', 'platform.example')).toBeNull();
  });
});
