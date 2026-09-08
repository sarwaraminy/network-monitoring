import { useCallback } from 'react';
import { describeError } from '../api/client';
import type { MessageParams } from './generated/message';
import { type UiMessageKey, useT } from './ui';

/**
 * A message a component is holding on to — what to say, not the words for it.
 *
 * Every banner and toast in the application used to store the rendered sentence:
 * `setMessage({ severity: 'success', text: t('console_settings.saved') })`. That
 * is correct exactly once. The string is fixed at the moment of the action, so
 * switching language afterwards left the old words sitting on screen while the
 * interface around them changed — reported from the running application as "I
 * switched from Dari to German and still see the Dari words", and true of all
 * sixteen places that stored a message this way.
 *
 * Keeping the key and rendering at display time makes the banner follow the
 * reader like everything else. The rendering is the cheap part; deciding what to
 * say is what the call site knows.
 *
 * `error` is the same problem one layer out. `describeError` reads the locale the
 * client is tracking, so calling it late gives the current language — but calling
 * it early and storing the result freezes it just as surely. Holding the error
 * itself defers that.
 */
export type Message =
  | { key: UiMessageKey; params?: MessageParams }
  /**
   * A failure, described in whatever language is current when it is shown.
   * Without a `fallbackKey`, `describeError` supplies its own generic wording —
   * which it also renders late, so that follows the reader too.
   */
  | { error: unknown; fallbackKey?: UiMessageKey };

/** Renders a held message now, in the language now in force. */
export function useMessageText(): (message: Message) => string {
  const t = useT();

  return useCallback(
    (message: Message) =>
      'key' in message
        ? t(message.key, message.params)
        : describeError(message.error, message.fallbackKey ? t(message.fallbackKey) : undefined),
    [t],
  );
}
