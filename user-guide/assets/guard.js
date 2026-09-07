/*
 * The guide's client-side session guard — the second of two layers.
 *
 * The first is the server's: every request for a file under /user-guide carries a
 * session cookie the API checks, so an anonymous visitor never gets a page at
 * all. That check is authoritative and this script cannot replace it.
 *
 * What it covers is the case a cookie check cannot see. The guide opens in its
 * own tab and can sit there for hours. If the person signs out in the application
 * tab meanwhile, the cookie is cleared — but this already-loaded page keeps
 * showing what it was showing, and every link inside it still works until the
 * cookie's own expiry catches up. The same shape as the client guard the sibling
 * `professional` project injects into its help pages, and for the same reason.
 *
 * Two triggers, because a sign-out can happen in either direction:
 *
 *   - the `storage` event, which fires in THIS tab when another tab removes the
 *     access token — the actual cross-tab sign-out signal;
 *   - a check when the tab is brought back to the front, which catches a sign-out
 *     that happened while this tab was hidden and in a browser that coalesced the
 *     storage events.
 *
 * Same-origin with the application, so `localStorage` here is the application's
 * own. Read-only: this script never writes to it.
 */
(function () {
  'use strict';

  // Must match TOKEN_STORAGE_KEY in the application's api/client.ts.
  var TOKEN_KEY = 'nmt.token';
  var SIGN_IN = '/login';

  function signedIn() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) !== null;
    } catch (error) {
      /*
       * Storage can throw rather than return null — a browser configured to block
       * site data, or a page opened in a context where it is unavailable. Treat
       * that as "cannot tell", not as "signed out": bouncing somebody to a sign-in
       * page they are already past, because their browser declined to answer a
       * question, is worse than showing them documentation the server already
       * decided they could have.
       */
      return true;
    }
  }

  function leave() {
    if (!signedIn()) window.location.replace(SIGN_IN);
  }

  // Another tab signed out. `event.key` is null when storage was cleared wholesale.
  window.addEventListener('storage', function (event) {
    if (event.key === TOKEN_KEY || event.key === null) leave();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') leave();
  });

  // And on load, so a page restored from the back/forward cache after a sign-out
  // does not sit there looking current.
  window.addEventListener('pageshow', leave);
})();
