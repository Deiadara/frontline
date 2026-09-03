import { describe, expect, it } from 'vitest';
import {
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
  MessageBodySchema,
  MessageSubjectSchema,
  QUOTE_MAX,
  quoted,
  replySubject,
} from './messages.js';

/**
 * A draft the game wrote for the player has to be one the game will accept.
 *
 * Both helpers *grow* the text they are handed: `Re: ` is four more characters and `quoted` puts
 * `> ` on every line under a two-line header. Neither was bounded by the schema on the other side
 * of the send, so a long-but-legal message produced a reply box the player had not typed a
 * character into and could not send, refused for a length nothing on the screen shows.
 */

const filled = (length: number, char = 'a'): string => char.repeat(length);

describe('the subject a reply opens with', () => {
  it('accepts a reply to a subject of exactly the length the schema allows', () => {
    const longest = filled(MESSAGE_SUBJECT_MAX);
    expect(MessageSubjectSchema.safeParse(longest).success).toBe(true);
    expect(MessageSubjectSchema.safeParse(replySubject(longest)).success).toBe(true);
  });

  it('accepts a reply to a subject of every length up to the ceiling', () => {
    for (let length = 1; length <= MESSAGE_SUBJECT_MAX; length += 1) {
      const draft = replySubject(filled(length));
      expect(MessageSubjectSchema.safeParse(draft).success, `${length}`).toBe(true);
    }
  });

  it('still prefixes once and only once', () => {
    expect(replySubject('A plan')).toBe('Re: A plan');
    expect(replySubject('Re: A plan')).toBe('Re: A plan');
    expect(replySubject('re: a plan')).toBe('re: a plan');
  });
});

describe('the body a reply opens with', () => {
  const wrote = (body: string) => quoted({ senderName: 'Vex of the Ninth Street Crew', body });

  it('accepts a quote of a body of exactly the length the schema allows', () => {
    const longest = filled(MESSAGE_BODY_MAX);
    expect(MessageBodySchema.safeParse(longest).success).toBe(true);
    expect(MessageBodySchema.safeParse(wrote(longest)).success).toBe(true);
  });

  it('accepts a quote of a many-lined body, which grows fastest', () => {
    // 40 lines of 48 characters: 1,959 characters, legal, and the shape that grows most under
    // `> ` per line. This is the case the review measured at 2,058.
    const many = Array.from({ length: 40 }, () => filled(48)).join('\n');
    expect(many.length).toBeLessThanOrEqual(MESSAGE_BODY_MAX);
    expect(MessageBodySchema.safeParse(wrote(many)).success).toBe(true);
  });

  it('leaves the player room to actually write a reply', () => {
    expect(wrote(filled(MESSAGE_BODY_MAX)).length).toBeLessThanOrEqual(QUOTE_MAX);
    expect(MESSAGE_BODY_MAX - QUOTE_MAX).toBeGreaterThan(200);
  });

  it('quotes a short message whole, which is the ordinary case', () => {
    const draft = wrote('Meet me at the docks.\nBring the truck.');
    expect(draft).toContain('> Meet me at the docks.');
    expect(draft).toContain('> Bring the truck.');
    expect(draft).not.toContain('...');
  });
});
