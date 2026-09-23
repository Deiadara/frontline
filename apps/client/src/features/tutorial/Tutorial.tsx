import { TUTORIAL_STEPS, nextTutorialCard, tutorialFinished } from '@frontline/shared';
import { useMarkTutorialSeen, useMe } from '../../lib/queries';
import { TutorialCard } from './TutorialCard';

/**
 * The opening tutorial, as one element a screen drops in (maintainer, 2026-09-22).
 *
 * Six cards, one per screen, first visit only, and a Skip on every one that ends all of them.
 * What decides whether anything is drawn is `user.tutorialSeen` off `/me`, so the answer is the
 * account's rather than this browser's and the set survives a reload, a second tab and a second
 * machine.
 *
 * ## Why this is a component and not a provider
 *
 * Each screen renders `<Tutorial screen="missions" />` where it wants the card to appear. The
 * alternative, one provider at the root watching the route, means the tutorial has to carry its
 * own copy of the route table and go wrong every time a path moves. A screen naming its own card
 * cannot drift from the screen it is about.
 *
 * Nothing is rendered once the set is complete, which is every player's state after the first
 * session, so the cost on every later render is one array check.
 */
export function Tutorial({ screen }: { screen: string }) {
  const me = useMe();
  const mark = useMarkTutorialSeen();
  const seen = me.data?.user.tutorialSeen ?? [];

  /*
   * Nothing until `/me` has answered.
   *
   * With no data `seen` is empty, and an empty set means "show the first card", so drawing before
   * the read lands would flash the welcome card at a player who finished the tutorial weeks ago.
   * `isSuccess` rather than `data !== undefined` so a cached-but-erroring read does not count.
   */
  if (!me.isSuccess) return null;
  if (tutorialFinished(seen)) return null;

  const card = nextTutorialCard(screen, seen);
  if (!card) return null;

  const remaining = TUTORIAL_STEPS.filter((step) => !seen.includes(step)).length;

  return (
    <TutorialCard
      card={card}
      remaining={remaining}
      pending={mark.isPending}
      onNext={() => mark.mutate({ steps: [card.step] })}
      /*
       * Skip writes **every** step, which is what makes "skipped" and "seen them all" one state.
       * A separate flag would be a second thing to read, a second thing to migrate, and a second
       * thing to be wrong about when the two disagree.
       */
      onSkip={() => mark.mutate({ steps: [...TUTORIAL_STEPS] })}
    />
  );
}
