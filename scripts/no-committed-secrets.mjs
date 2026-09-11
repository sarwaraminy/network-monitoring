/*
 * Refuses a commit that stages a credential, or a filename nobody can read.
 *
 * Written because both happened at once. A five-line `pg.Pool` script, made to
 * check a column list and meant to be deleted in the same breath, was committed
 * to a PUBLIC repository carrying a full Postgres URL with the password inline.
 * What let it through was the second half: a shell quoting accident had
 * mangled the filename into non-ASCII, so `git status` showed a line of garbage
 * rather than a name, and a glance over the staged list did not register it as a
 * file at all.
 *
 * `.gitignore` is the wrong tool for that. It needs a name to match, and the
 * whole problem was that the name was unrecognisable. This checks the two things
 * that actually went wrong.
 *
 * **Deliberately narrow.** A secret scanner that guesses at entropy would fire on
 * test fixtures, hashes and base64 in this repository and be switched off within
 * a week. These patterns match credentials embedded in a URL and the two private
 * key headers — shapes with no legitimate reason to be in a commit here, given
 * every real credential this application uses is read from the environment.
 *
 * Not a security boundary either: anyone can pass `--no-verify`, and the hook
 * does not run on a merge or a rebase. It is a guard against the accident it is
 * named after, and the comment says so rather than letting somebody rely on it.
 */
import { execFileSync } from 'node:child_process';

/** A credential inside a connection string, which is how this one escaped. */
const SECRET_PATTERNS = [
  {
    /*
     * A scheme, then a user, then a colon, then a secret, then an at-sign. The
     * user half is required, so a bare `https://example.com` cannot match.
     *
     * Described rather than illustrated, deliberately. The first version of this
     * file wrote the shape out as an example and the hook then refused to commit
     * itself — a fair demonstration that it works, and a guard nobody can land is
     * a guard nobody keeps.
     */
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]+@/i,
    what: 'a connection string with an embedded password',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    what: 'a private key',
  },
];

/** Every staged path, as raw bytes, so a mangled name survives the round trip. */
function stagedPaths() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  return out
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '');
}

/**
 * A path a person could recognise in `git status`.
 *
 * Printable ASCII plus the separators git uses. Anything else is either a
 * deliberate non-English filename — which this repository has none of, and which
 * would be worth a conversation rather than a silent commit — or the quoting
 * accident this file exists for.
 */
const READABLE = /^[\x20-\x7e]+$/;

const problems = [];

for (const path of stagedPaths()) {
  if (!READABLE.test(path)) {
    problems.push(
      `${JSON.stringify(path)} — the filename is not readable ASCII, which is usually a shell quoting accident`,
    );
    continue;
  }

  let content = '';
  try {
    content = execFileSync('git', ['show', `:${path}`], { maxBuffer: 32 * 1024 * 1024 }).toString('utf8');
  } catch {
    // Binary, deleted, or unreadable. Nothing to scan; the name check above has
    // already had its say.
    continue;
  }

  for (const { pattern, what } of SECRET_PATTERNS) {
    if (pattern.test(content)) problems.push(`${path} — contains what looks like ${what}`);
  }
}

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
