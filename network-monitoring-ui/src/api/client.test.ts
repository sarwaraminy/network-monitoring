import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { describeError, setErrorLocale } from './client';

/**
 * What a person is shown when a request fails.
 *
 * An error response carries two fields on purpose: `code`, which is a catalogue
 * key and translates, and `message`, which is always English and always present.
 * The interesting case is the one where they disagree about what this bundle can
 * do — a code it has never heard of — because the failure there is silent. The
 * render "succeeds", and what reaches the screen is an identifier.
 *
 * It is not an exotic case. A server that ships a new code reaches browsers
 * holding a bundle from before it, and during a rolling deploy both versions are
 * live at once.
 */
function responseWith(data: unknown): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    data,
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('describeError', () => {
  it('translates a code the catalogue knows', () => {
    setErrorLocale('de');
    expect(describeError(responseWith({ code: 'error.interface_required', message: 'ignored' }))).toBe(
      'interfaceName ist erforderlich',
    );
    setErrorLocale('en');
  });

  it('falls back to the English message when the code is unknown', () => {
    // The whole point. Rendering the key would put `error.invented_later` on
    // screen while the sentence explaining it sat unused in the same response.
    const shown = describeError(
      responseWith({ code: 'error.invented_later', message: 'Your session has expired.' }),
    );

    expect(shown).toBe('Your session has expired.');
    expect(shown).not.toContain('error.invented_later');
  });

  it('shows an unknown code rather than a generic sentence when nothing else is offered', () => {
    // Last resort, and still better than "Something went wrong": the key is the
    // one string that says which failure this was.
    expect(describeError(responseWith({ code: 'error.invented_later' }))).toBe('error.invented_later');
  });

  it('prefers the message when there is no code at all', () => {
    expect(describeError(responseWith({ message: 'Database is down' }))).toBe('Database is down');
  });
});
