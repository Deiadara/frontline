import { FACTION_REFUSAL_TEXT } from '@frontline/shared';

/**
 * A refusal from the server, said in the player's language rather than as a code.
 *
 * Its own module because three screens now show one (the faction page, the founding screen and the
 * invitation card in the mailbox), and a copy per screen is how two of them end up saying different
 * things about the same refusal.
 */
export function refusalText(message: string): string {
  return (FACTION_REFUSAL_TEXT as Record<string, string>)[message] ?? message;
}
