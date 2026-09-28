/**
 * The scenes, in the order they are played. Later scenes lean on what earlier ones set up.
 */
import type { Scene } from './playthrough-run.js';
import { accounts } from './playthrough-scene-accounts.js';
import { levelGates } from './playthrough-scene-gates.js';
import { settings, sessions } from './playthrough-scene-settings.js';
import { district } from './playthrough-scene-district.js';
import { missions } from './playthrough-scene-missions.js';
import { barScene, twoWeeksOn } from './playthrough-scene-bar.js';
import { crewScene } from './playthrough-scene-crew.js';
import { city } from './playthrough-scene-city.js';
import { factions, mailAndBell } from './playthrough-scene-social.js';
import { battles } from './playthrough-scene-battles.js';
import { marketScene } from './playthrough-scene-market.js';
import { goods } from './playthrough-scene-goods.js';
import { automations, feats, standings } from './playthrough-scene-standing.js';
import { doors } from './playthrough-scene-doors.js';
import { edges } from './playthrough-scene-edges.js';
import { adminBench } from './playthrough-scene-admin.js';

export const SCENES: readonly Scene[] = [
  { name: 'accounts and onboarding', run: accounts },
  { name: 'level gates', run: levelGates },
  { name: 'settings', run: settings },
  { name: 'the district', run: district },
  { name: 'missions', run: missions },
  { name: 'two weeks on (bench)', run: twoWeeksOn },
  { name: 'the Bar', run: barScene },
  { name: 'the crew, the Archive and drills', run: crewScene },
  { name: 'the city', run: city },
  { name: 'factions', run: factions },
  { name: 'mail, the bell and the live channel', run: mailAndBell },
  { name: 'battles', run: battles },
  { name: 'the market', run: marketScene },
  { name: 'goods: the back room, blueprints, the Scrapyard, the Garage', run: goods },
  { name: 'edges and races', run: edges },
  { name: 'feats', run: feats },
  { name: 'automations', run: automations },
  { name: 'standings and profiles', run: standings },
  { name: 'doors: every route', run: doors },
  { name: 'sessions', run: sessions },
];

export const ADMIN_SCENES: readonly Scene[] = [{ name: 'the admin bench', run: adminBench }];
