/**
 * Which visual treatment a navigation item gets.
 *
 * Pulled out as a pure function for one reason: `AppLayout` has no test harness
 * worth the name — mounting the shell drags in routing, the auth context and the
 * colour-scheme provider — so this branching would otherwise live as scattered
 * `isActive && !dark` checks inside `sx` callbacks with no way to assert any of
 * them. As one named thing it can be pinned directly, and the component is left
 * only mapping an answer onto colours.
 *
 * The three states are not "active or not, plus a theme flag". They are three
 * genuinely different treatments, and which one is right depends on what the bar
 * is made of:
 *
 *  - `lifted`     — the light scheme's active item. A tinted surface with
 *                   rounded corners, so the current page reads as raised out of
 *                   the bar.
 *  - `underlined` — the dark scheme's active item. Against a near-black bar a
 *                   tinted slab is the brightest thing on screen and pulls the
 *                   eye away from the alerts it is meant to be watching, so the
 *                   state is carried by a rule under the label instead.
 *  - `inactive`   — sits on the bar in both schemes, at secondary-text weight.
 *
 * The marker is drawn on every item, transparent when inactive, so labels stay
 * on one baseline instead of the active one shifting as the selection moves.
 * That rule holds for the drawer's left rule as much as the bar's underline.
 */
export type NavTreatment = 'lifted' | 'underlined' | 'inactive';

export function navTreatment(isActive: boolean, dark: boolean): NavTreatment {
  if (!isActive) return 'inactive';
  return dark ? 'underlined' : 'lifted';
}

export default navTreatment;
