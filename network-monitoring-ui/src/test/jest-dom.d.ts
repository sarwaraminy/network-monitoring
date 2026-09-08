import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/**
 * Teaches `expect(...)` about jest-dom's matchers again, under Vitest 4.
 *
 * `@testing-library/jest-dom/vitest` augments `declare module 'vitest'` with an
 * `Assertion` interface. That worked while `Assertion` was declared in `vitest`
 * itself. Vitest 4 moved it — and the `Matchers<T>` interface that exists purely
 * to be extended — into `@vitest/expect`, so jest-dom's augmentation now merges
 * into a module that no longer declares the thing it is trying to extend. It
 * fails silently: nothing errors at the augmentation site, and every
 * `toBeInTheDocument` in the suite becomes TS2339 instead. 346 of them, in this
 * repository.
 *
 * `Matchers<T>` rather than `Assertion<T>` because that is the extension point
 * `@vitest/expect` documents in its own source — "allow unused `T` to preserve
 * its name for extensions" — and `Assertion` already extends it, so `expect`,
 * `expect(...).not` and the promisified forms all pick these up from one
 * declaration.
 *
 * `AsymmetricMatchersContaining` is extended for the same reason jest-dom
 * extends it: `expect.objectContaining({ el: expect.toBeInTheDocument() })` and
 * friends read their matchers from there rather than from `Assertion`.
 *
 * This file is a `.d.ts` under `src/`, so `tsconfig.json`'s `include` picks it
 * up without anything importing it. Delete it when jest-dom ships an
 * augmentation that targets `@vitest/expect` — at which point these interfaces
 * merge with theirs rather than replacing anything, so the failure mode of
 * forgetting is a duplicate declaration rather than silence.
 */
declare module '@vitest/expect' {
  // biome-ignore lint/suspicious/noExplicitAny: the shape jest-dom and Vitest both use.
  interface Matchers<T = any> extends TestingLibraryMatchers<any, T> {}
  // biome-ignore lint/suspicious/noExplicitAny: as above.
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
