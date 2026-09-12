/*
 * Refuses a commit that stages a credential, or a filename nobody can read.
 *
 * Written because both happened at once. A five-line `pg.Pool` script, made to
 * check a column list and meant to be deleted in the same breath, was committed
 * to a PUBLIC repository carrying a full Postgres URL with the password inline.
 * What let it through was the second half: a shell quoting accident had mangled
 * the filename into non-ASCII, so `git status` showed a line of garbage rather
 * than a name, and a glance over the staged list did not register it as a file at
 * all.
 *
 * `.gitignore` is the wrong tool for that. It needs a name to match, and the
 * whole problem was that the name was unrecognisable. This checks the two things
 * that actually went wrong.
 *
 * **Deliberately narrow.** A secret scanner that guesses at entropy would fire on
 * the fixtures, hashes and base64 already in this repository and be switched off
 * within a week. These patterns match credentials embedded in a URL and the two
 * private key headers — shapes with no legitimate reason to be in a commit here,
 * given every real credential this application uses is read from the environment.
 *
 * **And it must not fire on this repository as it stands**, which is the property
 * `no-committed-secrets.test.ts` pins. The first version did: nine tracked files
 * carry a URL-shaped string, from the README's documented example to the
 * `postgres:postgres` every CI Postgres service uses, and two of them were in the
 * diff of the commit that introduced this file — so the guard refused the branch
 * that added it. A guard that fires on the repository's own documentation and
 * fixtures is one that gets bypassed with `--no-verify` within a week, which
 * leaves the real thing uncaught.
 *
 * Not a security boundary either: anyone can pass `--no-verify`, and the hook
 * does not run on a merge or a rebase. It is a guard against the accident it is
 * named after, and this comment says so rather than letting somebody rely on it.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * A value that says of itself that it is not a real one.
 *
 * Anything containing these words: `yourpassword`, `CHANGE_ME`,
 * `ci-postgres-password`, `example-secret`. A credential somebody actually has to
 * protect does not have the word "password" inside it, so this is a rule about
 * what the string claims rather than a list of the strings this repository
 * happens to contain — which is what stops the exemptions growing one incident at
 * a time.
 */
const SAYS_IT_IS_A_STAND_IN = /password|changeme|change_me|placeholder|example|sample|dummy|redacted/i;

/**
 * The stand-ins that do not announce themselves, as exact values.
 *
 * Keyed on the VALUE, not on the file. A path allowlist would have been quicker
 * and would have meant a real credential pasted into the README sailed through —
 * and the README is precisely where somebody would paste one while writing up a
 * deployment.
 *
 * `postgres` is here because `postgres:postgres` is what every CI Postgres
 * service in the world is configured with, including this repository's. A
 * password equal to its own username is not a secret by any definition, so
 * treating it as one buys nothing and costs the whole check's credibility.
 * `nothing` is half of the deliberately unusable `nobody:nothing@127.0.0.1:1`
 * that five test files point at to prove they never connect.
 *
 * Short, and meant to stay short. If this has to keep growing, that is the signal
 * the pattern is too broad to be worth keeping rather than a reason to add one
 * more.
 */
export const PLACEHOLDERS = new Set(['secret', 'nothing', 'none', 'postgres', 'user', 'pass']);

/** Whether a captured password is evidently not a real one. */
export function isPlaceholder(value) {
  return PLACEHOLDERS.has(value.toLowerCase()) || SAYS_IT_IS_A_STAND_IN.test(value);
}

/** What has no legitimate reason to be in a commit here. */
export const SECRET_PATTERNS = [
  {
    /*
     * A scheme, then a user, then a colon, then a secret, then an at-sign. The
     * user half is required, so a bare `https://example.com` cannot match, and
     * the secret is captured so it can be weighed against `PLACEHOLDERS`.
     *
     * Described rather than illustrated, deliberately. The first version of this
     * file wrote the shape out as an example and the hook then refused to commit
     * itself — a fair demonstration that it works, and a guard nobody can land is
     * a guard nobody keeps.
     */
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s:/@]+)@/gi,
    what: 'a connection string with an embedded password',
    ignore: isPlaceholder,
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    what: 'a private key',
  },
];

/**
 * A path a person could recognise in `git status`.
 *
 * Printable ASCII plus the separators git uses. Anything else is either a
 * deliberate non-English filename — which this repository has none of, and which
 * would be worth a conversation rather than a silent commit — or the quoting
 * accident this file exists for.
 */
const READABLE = /^[\x20-\x7e]+$/;

/** What is wrong with one file, or nothing. Exported so a test can drive it. */
export function inspect(path, content) {
  const problems = [];

  if (!READABLE.test(path)) {
    problems.push(
      `${JSON.stringify(path)} — the filename is not readable ASCII, which is usually a shell quoting accident`,
    );
    // No point scanning content for a file nobody can name.
    return problems;
  }

  for (const { pattern, what, ignore } of SECRET_PATTERNS) {
    /*
     * Every occurrence, not the first, and `lastIndex` reset between files.
     *
     * A `/g` regex carries its position across calls, so a shared one silently
     * skips the start of the next file it is used on. And a file may document
     * the shape with a placeholder near the top and carry a real credential
     * further down — stopping at the first match would clear it on the strength
     * of the example.
     */
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const captured = match[1];
      if (ignore && captured !== undefined && ignore(captured)) continue;
      problems.push(`${path} — contains what looks like ${what}`);
      break;
    }
  }

  return problems;
}

/** Every staged path, as text, so a mangled name survives the round trip. */
function stagedPaths() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  return out
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '');
}

function contentOf(path) {
  try {
    return execFileSync('git', ['show', `:${path}`], { maxBuffer: 32 * 1024 * 1024 }).toString('utf8');
  } catch {
    // Binary, deleted, or unreadable. Nothing to scan; the name check has
    // already had its say.
    return '';
  }
}

/** The staged tree's problems, for the hook. */
export function inspectStaged() {
  return stagedPaths().flatMap((path) => inspect(path, contentOf(path)));
}

// `.husky/pre-commit` runs this file directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = inspectStaged();

  if (problems.length > 0) {
    console.error('\nRefusing to commit:\n');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(
      '\nIf a credential is involved, rotate it before doing anything else: a commit that reaches a\n' +
        'public remote is published, and deleting the file afterwards does not unpublish it.\n' +
        'Scratch scripts belong in the system temp directory, not the repository root.\n',
    );
    process.exit(1);
  }
}
