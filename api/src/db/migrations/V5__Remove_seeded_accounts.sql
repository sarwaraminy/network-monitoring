-- SECURITY: remove the demo accounts seeded by V2.
--
-- V2 inserted admin@example.com (ADMIN) and user@example.com (USER) with the
-- same bcrypt hash, committed to this repository. A published hash is a
-- published credential: it is cost-10 bcrypt, so a wordlist run recovers the
-- plaintext and yields ADMIN on every deployment of this software that ever ran
-- these migrations. DB_AUTO_MIGRATE defaults on, so that is every deployment.
--
-- The second consequence is quieter and just as bad. Because the users table was
-- never empty, hasAnyUser() was always true, so the first-admin bootstrap path
-- and the pg_advisory_xact_lock that guards it could never execute. The careful
-- path was unreachable and the insecure default was what ran.
--
-- Deleting by hash rather than by email: an operator who kept the addresses but
-- set real passwords should keep their accounts. Only rows still carrying the
-- published credential go.
DELETE FROM users
WHERE password = '$2a$10$6ew/Mx7CgzJuAqJ0o8hvOukno6tdFTc6WQeWPSS79gv.UcXR23jSu';
