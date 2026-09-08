import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_ONLY,
  ADMIN_TOKEN_REQUIRED,
  decideSignup,
  type Role,
  type SignupActor,
  signupMode,
} from './signup-policy.js';

/**
 * Regression tests for a real, verified privilege-escalation hole.
 *
 * `POST /auth/signup` was unauthenticated and honoured a `role` of `ADMIN` taken
 * from the request body. Against a running server, one anonymous POST returned
 * HTTP 201 with `"role":"ADMIN"` — a complete takeover of a security monitoring
 * tool by anyone who could reach the port.
 *
 * The decision is pure and lives in one function so it can be pinned exhaustively
 * here. These tests exist to make that hole impossible to reopen by accident, so
 * they are deliberately explicit about *every* combination rather than only the
 * happy paths.
 */

const ANON: SignupActor = { actorIsAdmin: false, bootstrap: false };
const ADMIN: SignupActor = { actorIsAdmin: true, bootstrap: false };
const EMPTY_INSTALL: SignupActor = { actorIsAdmin: false, bootstrap: true };

describe('signup policy', () => {
  describe('the hole that was fixed', () => {
    it('refuses an anonymous request asking for ADMIN', () => {
      const decision = decideSignup(ANON, 'ADMIN', false);
      assert.equal(decision.allowed, false);
      assert.equal(decision.allowed === false && decision.status, 401);
      // The decision names a catalogue key now, not a sentence. Asserted against the
      // key *and* the English it renders to, so neither can drift from the other.
      assert.equal(decision.allowed === false && decision.code, 'error.signup_token_required');
      assert.match(ADMIN_TOKEN_REQUIRED, /administrator token/);
    });

    it('refuses an anonymous request even asking only for USER', () => {
      // Not just role escalation: anonymous account creation is itself the problem,
      // because any account can then read every finding on the network.
      const decision = decideSignup(ANON, 'USER', false);
      assert.equal(decision.allowed, false);
    });

    it('refuses a signed-in non-admin asking for ADMIN', () => {
      const decision = decideSignup(ANON, 'ADMIN', false, true);
      assert.equal(decision.allowed, false);
      assert.equal(decision.allowed === false && decision.status, 403);
      assert.equal(decision.allowed === false && decision.code, 'error.signup_admin_only');
      assert.match(ADMIN_ONLY, /Only an administrator/);
    });

    it('refuses a signed-in non-admin asking for USER', () => {
      const decision = decideSignup(ANON, 'USER', false, true);
      assert.equal(decision.allowed, false);
      assert.equal(decision.allowed === false && decision.status, 403);
    });

    it('never returns ADMIN to anyone who is not an admin or bootstrapping', () => {
      // The exhaustive statement of the invariant that matters.
      for (const requested of ['USER', 'ADMIN'] as Role[]) {
        for (const openSignup of [false, true]) {
          for (const authenticatedNotAdmin of [false, true]) {
            const decision = decideSignup(ANON, requested, openSignup, authenticatedNotAdmin);
            if (decision.allowed) {
              assert.equal(
                decision.role,
                'USER',
                `a non-admin got ${decision.role} (requested ${requested}, open=${openSignup})`,
              );
            }
          }
        }
      }
    });
  });

  describe('an authenticated administrator', () => {
    it('may create a USER', () => {
      const decision = decideSignup(ADMIN, 'USER', false);
      assert.deepEqual(decision, { allowed: true, role: 'USER', reason: 'admin' });
    });

    it('may create another ADMIN', () => {
      const decision = decideSignup(ADMIN, 'ADMIN', false);
      assert.deepEqual(decision, { allowed: true, role: 'ADMIN', reason: 'admin' });
    });

    it('is unaffected by the open-signup setting', () => {
      assert.equal(decideSignup(ADMIN, 'ADMIN', true).allowed, true);
      assert.equal(decideSignup(ADMIN, 'ADMIN', false).allowed, true);
    });
  });

  describe('first account on an empty installation', () => {
    it('is permitted without a token, because nobody could authorise it', () => {
      const decision = decideSignup(EMPTY_INSTALL, 'USER', false);
      assert.equal(decision.allowed, true);
      assert.equal(decision.allowed && decision.reason, 'bootstrap');
    });

    it('is forced to ADMIN whatever was asked for', () => {
      // Otherwise the installation would have no way to administer itself.
      for (const requested of ['USER', 'ADMIN'] as Role[]) {
        const decision = decideSignup(EMPTY_INSTALL, requested, false);
        assert.equal(decision.allowed && decision.role, 'ADMIN');
      }
    });

    it('does not apply once any account exists', () => {
      // The window has to shut, or it could be used to add a second admin.
      const decision = decideSignup({ actorIsAdmin: false, bootstrap: false }, 'ADMIN', false);
      assert.equal(decision.allowed, false);
    });

    it('does not apply to a request that presented a non-admin token', () => {
      // Bootstrap is for "no accounts exist". A caller holding a USER token is
      // proof that one does, so this combination must never grant ADMIN.
      const decision = decideSignup(EMPTY_INSTALL, 'ADMIN', false, true);
      assert.equal(decision.allowed, false);
      assert.equal(decision.allowed === false && decision.status, 403);
    });
  });

  describe('open signup, when deliberately enabled', () => {
    it('permits registration', () => {
      const decision = decideSignup(ANON, 'USER', true);
      assert.equal(decision.allowed, true);
      assert.equal(decision.allowed && decision.reason, 'open-signup');
    });

    it('silently downgrades a request for ADMIN to USER', () => {
      // Downgrade rather than reject: an attacker learns nothing from it, and a
      // legitimate registration still succeeds.
      const decision = decideSignup(ANON, 'ADMIN', true);
      assert.equal(decision.allowed, true);
      assert.equal(decision.allowed && decision.role, 'USER');
    });
  });

  describe('reported mode', () => {
    it('is first-admin on an empty installation', () => {
      assert.equal(signupMode(false, false), 'first-admin');
      // Even with open signup off — the first account still has to be creatable.
      assert.equal(signupMode(false, true), 'first-admin');
    });

    it('is admin-only once users exist and open signup is off', () => {
      assert.equal(signupMode(true, false), 'admin-only');
    });

    it('is open when users exist and open signup is on', () => {
      assert.equal(signupMode(true, true), 'open');
    });
  });
});
