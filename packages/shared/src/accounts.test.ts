import { describe, expect, it } from 'vitest';
import {
  DisplayNameSchema,
  PASSWORD_MAX_BYTES,
  PasswordSchema,
  SEEDED_BOT_USERNAMES,
  isReservedName,
  sameDisplayName,
  utf8Length,
} from './accounts.js';
import { ChangePasswordRequestSchema, UpdateProfileRequestSchema } from './api.accounts.js';
import { GOVERNMENT } from './allegiance.js';
import { RegisterRequestSchema } from './api.js';
import { MVP_DEV_CREDENTIALS } from './mvp.js';
import { displayNameOf } from './user.js';

describe('reserved names (bug pass, 2026-09-29)', () => {
  it.each([
    'Combine',
    'the_combine',
    'THE COMBINE',
    'Directive_Xero',
    'directive-xero',
    'Directive Xero',
    'syndic',
    'Executioner',
    'admin',
    'Administrator',
    'SYSTEM',
    'moderator',
    'staff',
    'Front_Line',
    'government',
    'Vex_Holdings',
    'sable-ninth',
    'Halvard_Line',
  ])('%s is the game’s', (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each(['alice', 'Combiner', 'adminton', 'syndicate_kid', 'Xero', MVP_DEV_CREDENTIALS.username])(
    '%s is a player’s to take',
    (name) => {
      expect(isReservedName(name)).toBe(false);
    },
  );

  /*
   * A bot is another crew, and a crew called after the regime reads as the regime playing
   * (maintainer, 2026-10-01): the rival was `Vex_Combine` until then.
   */
  it('names no seeded bot after the Combine', () => {
    for (const username of SEEDED_BOT_USERNAMES) {
      expect(username.toLowerCase(), username).not.toContain(GOVERNMENT.adjective.toLowerCase());
    }
  });

  it('refuses one at sign-up and says why', () => {
    const parsed = RegisterRequestSchema.safeParse({
      username: 'Directive_Xero',
      password: 'hunter2pass',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/belongs to the game/);
  });
});

describe('display names (bug pass, 2026-09-29)', () => {
  it('strips control and format characters rather than storing them', () => {
    // A right-to-left override and a zero-width space around a name: the entry's own example.
    expect(DisplayNameSchema.parse('‮evil​')).toBe('evil');
    expect(DisplayNameSchema.parse(' Ali\u0000ce ')).toBe('Alice');
  });

  it('refuses a name that is empty once they are gone', () => {
    const parsed = DisplayNameSchema.safeParse('‮​‍');
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/at least one character that shows/);
  });

  it('refuses a reserved name, whatever the spacing', () => {
    expect(DisplayNameSchema.safeParse('Directive  Xero').success).toBe(false);
    expect(DisplayNameSchema.safeParse('The Combine').success).toBe(false);
  });

  it('still lets the profile request take one off with null', () => {
    expect(UpdateProfileRequestSchema.parse({ displayName: null })).toEqual({ displayName: null });
  });

  it('compares ignoring case and invisible characters', () => {
    expect(sameDisplayName('Alice', 'alice')).toBe(true);
    // Look-alikes from other scripts, accents, and the digits that read as letters (2026-10-02).
    expect(sameDisplayName('Kestrel', 'K\u0435strel')).toBe(true); // Cyrillic e
    expect(sameDisplayName('Sable', 'S\u03b1ble')).toBe(true); // Greek alpha
    expect(sameDisplayName('Noir', 'No\u00efr')).toBe(true);
    expect(sameDisplayName('Vex', 'V3x')).toBe(false);
    expect(sameDisplayName('Bolt', 'B0lt')).toBe(true);
    expect(sameDisplayName('Corn', 'Com')).toBe(true);
    expect(sameDisplayName('Kestrel', 'Kestrels')).toBe(false);
    expect(sameDisplayName('Al​ice', 'ALICE')).toBe(true);
    expect(sameDisplayName('Alice', 'Alicia')).toBe(false);
  });

  it('prints an older row without its invisible characters, or the username if nothing is left', () => {
    expect(displayNameOf({ username: 'bobby', displayName: '‮evil​' })).toBe('evil');
    expect(displayNameOf({ username: 'bobby', displayName: '‮​' })).toBe('bobby');
    expect(displayNameOf({ username: 'bobby', displayName: null })).toBe('bobby');
  });
});

describe('passwords stop at bcrypt’s 72 bytes (bug pass, 2026-09-29)', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('a')).toBe(1);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('🔒')).toBe(4);
  });

  it('takes 72 one-byte characters and refuses a 73rd', () => {
    expect(PasswordSchema.safeParse('a'.repeat(PASSWORD_MAX_BYTES)).success).toBe(true);
    expect(PasswordSchema.safeParse('a'.repeat(PASSWORD_MAX_BYTES + 1)).success).toBe(false);
  });

  it('refuses 30 characters that are 90 bytes', () => {
    const accented = '€'.repeat(30);
    expect(accented.length).toBeLessThan(PASSWORD_MAX_BYTES);
    const parsed = PasswordSchema.safeParse(accented);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/72 bytes/);
  });

  it('holds at sign-up and on the settings screen alike', () => {
    const long = 'é'.repeat(37);
    expect(RegisterRequestSchema.safeParse({ username: 'alice', password: long }).success).toBe(
      false,
    );
    expect(ChangePasswordRequestSchema.safeParse({ newPassword: long }).success).toBe(false);
    expect(ChangePasswordRequestSchema.safeParse({ newPassword: 'é'.repeat(36) }).success).toBe(
      true,
    );
  });
});
