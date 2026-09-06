-- SMTP that modern mailboxes accept: XOAUTH2 alongside the password.
--
-- Microsoft 365 and Google both disable basic SMTP AUTH by default on modern
-- tenants, so the one thing a buyer tries first — "point it at our Office 365
-- mailbox" — fails, and fails with a 535 that is indistinguishable from a typo in
-- the password. See issue #27. An internal relay remains the right answer for an
-- on-prem sensor and needs none of this; these columns are for the tenants that
-- require OAuth2 and permit nothing else.
--
-- `email_auth_method` is the switch, and it is deliberately explicit rather than
-- inferred from "is a client id set". Inference would mean a half-entered OAuth2
-- configuration silently falls back to password auth and reports a rejected
-- password, which is the exact failure this whole issue is about. With the switch,
-- an incomplete OAuth2 setup names the variables that are missing instead.
--
-- NULL means "no opinion — fall through to the environment or the default", as
-- everywhere else in this table; see V7.

ALTER TABLE delivery_settings
    -- 'password' (AUTH LOGIN/PLAIN, or no AUTH at all when the user is blank) or
    -- 'oauth2' (XOAUTH2 with a refresh token).
    ADD COLUMN email_auth_method         VARCHAR(16),

    ADD COLUMN email_oauth_client_id     VARCHAR(255),
    -- A credential. Never returned by the API, same as email_password.
    ADD COLUMN email_oauth_client_secret VARCHAR(500),
    -- Also a credential, and the more dangerous of the two: it is what mints access
    -- tokens for the mailbox. Long, because a Microsoft refresh token routinely runs
    -- past a kilobyte where a Google one is a hundred characters.
    ADD COLUMN email_oauth_refresh_token VARCHAR(4000),
    -- The tenant's token endpoint. Required rather than defaulted: nodemailer would
    -- otherwise fall back to Google's, and a Microsoft tenant silently posting its
    -- refresh token to accounts.google.com is a worse failure than an empty field.
    ADD COLUMN email_oauth_token_url     VARCHAR(500),
    -- Optional. Google's refresh grant ignores it; Microsoft's wants the scopes the
    -- refresh token was issued for, and omitting it fails only on some tenants —
    -- which is precisely the kind of "works for me" difference worth having a field for.
    ADD COLUMN email_oauth_scope         VARCHAR(500);

-- Mirrors the closed set in notify/settings.ts, like every other CHECK here: the
-- resolver already refuses an unparseable stored value and falls through, so this
-- guards a hand-written UPDATE rather than being the only check.
ALTER TABLE delivery_settings
    ADD CONSTRAINT delivery_settings_email_auth_method_check
        CHECK (email_auth_method IS NULL OR email_auth_method IN ('password', 'oauth2'));
