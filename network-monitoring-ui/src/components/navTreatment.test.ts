import { describe, expect, it } from 'vitest';
import { navTreatment } from './navTreatment';

/**
 * The point of testing a three-line function is that it is the one place the
 * "you are here" decision is written down. Inside an `sx` callback it was
 * untestable, which is how a scheme-dependent branch silently stops applying.
 */
describe('navTreatment', () => {
  it('lifts the active item in the light scheme', () => {
    expect(navTreatment(true, false)).toBe('lifted');
  });

  it('underlines it in the dark scheme instead', () => {
    // A tinted slab on a near-black bar is the brightest thing on the page, and
    // this page is meant to draw the eye to alerts rather than to its own chrome.
    expect(navTreatment(true, true)).toBe('underlined');
  });

  it('treats an inactive item the same in both schemes', () => {
    expect(navTreatment(false, false)).toBe('inactive');
    expect(navTreatment(false, true)).toBe('inactive');
  });
});
