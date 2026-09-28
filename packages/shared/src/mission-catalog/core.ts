import type { MissionTemplate } from '../missions.js';

/**
 * The thirty-eight jobs the board had before the catalogue was regraded (maintainer, 2026-09-28).
 *
 * Each kept its brief, its clock and its mix. What changed is that each now carries the range of
 * grades it can be dealt at, read off the odds it used to be authored with, and names what it leans
 * on outright: the old default reading (a haul and some salvage for plain work, a fight for a
 * fight) is gone with the other three hundred jobs beside it.
 *
 * A fight leans on `fight` and nothing else (maintainer, 2026-09-28). The extra tags a fight used
 * to carry (a haul, a breach, a wire) graded its leader on attributes the engine never reads; who
 * should lead a fight is settled by fighting it (`missions/fight-leaders.ts` on the server), and
 * the tags stay on the plain jobs, where a leader's sheet is the whole of the odds.
 */
export const CORE_JOBS: readonly MissionTemplate[] = [
  {
    id: 'scrap-run',
    name: 'Scrap Run',
    brief:
      'The overpass came down in the spring and nobody has cleared it. Two blocks out. Take the crew, take the cutters, come back heavy.',
    kind: 'standard',
    grades: ['F-', 'F+'],
    travelBand: 'close',
    durationMinutes: 3,
    spoils: { scrap: 34, planks: 26, caps: 4 },
    leanings: ['haul', 'salvage'],
  },
  {
    id: 'ration-run',
    name: 'Ration Run',
    brief:
      'There is a growing bay under the market that still has power. Whoever runs it keeps strange hours. Go while the lights are off.',
    kind: 'standard',
    grades: ['F-', 'E-'],
    travelBand: 'close',
    durationMinutes: 12,
    spoils: { supplies: 87, caps: 20 },
    leanings: ['stealth', 'haul'],
  },
  {
    id: 'convoy-ambush',
    name: 'Convoy Ambush',
    brief:
      'Combine ration trucks take the ring road at dusk. Four minutes of work if it goes well. The escort is paid to make sure it does not.',
    kind: 'battle',
    grades: ['E-', 'E+'],
    travelBand: 'close',
    durationMinutes: 25,
    spoils: { caps: 90, oil: 60 },
    leanings: ['fight'],
  },
  {
    id: 'fuel-siphon',
    name: 'Fuel Siphon',
    brief:
      'Shift change at the Combine tank farm leaves twenty minutes with nobody watching the valves. Bring hose. Bring somebody who can stay quiet that long.',
    kind: 'standard',
    grades: ['F', 'E'],
    travelBand: 'further',
    durationMinutes: 45,
    spoils: { oil: 69, scrap: 15 },
    leanings: ['haul', 'stealth', 'salvage'],
  },
  {
    id: 'foundry-raid',
    name: 'Foundry Raid',
    brief:
      'The Combine smelter pours at two in the morning. Walk in while the metal is still moving and walk out with it finished. The floor crew will not thank you.',
    kind: 'battle',
    grades: ['D-', 'D+'],
    travelBand: 'further',
    durationMinutes: 60,
    spoils: { highQualityMetal: 10, scrap: 41 },
    leanings: ['fight'],
  },
  {
    id: 'courier-contract',
    name: 'Courier Contract',
    brief:
      'A Combine broker wants a sealed crate carried three districts over. He is not saying what is in it and you are not asking. Late is worse than light.',
    kind: 'standard',
    grades: ['F+', 'E+'],
    travelBand: 'further',
    durationMinutes: 90,
    spoils: { caps: 134 },
    leanings: ['road', 'talk', 'haul'],
  },
  {
    id: 'curfew-sweep',
    name: 'Curfew Sweep',
    brief:
      'The Combine is short of people on the lower tiers, so it is paying crews to hold its curfew for it. Good money. Your neighbours will remember who took it.',
    kind: 'battle',
    grades: ['E', 'E+'],
    travelBand: 'close',
    durationMinutes: 40,
    // Combine pay: caps and the metal a state armoury can spare, never supplies it would rather ration.
    spoils: { caps: 88, highQualityMetal: 5 },
    leanings: ['fight'],
  },
  {
    id: 'refinery-assault',
    name: 'Refinery Assault',
    brief:
      'Take the outer Combine refinery and sit on it long enough to empty the alloy store. Getting in is loud. Holding it is the hard part.',
    kind: 'battle',
    grades: ['B-', 'A-'],
    travelBand: 'furthest',
    durationMinutes: 480,
    spoils: { highQualityMetal: 11, oil: 27, scrap: 21 },
    leanings: ['fight'],
  },
  {
    id: 'deep-expedition',
    name: 'Deep Expedition',
    brief:
      'A full day out, past the last checkpoint, into ground nobody has mapped since the flood. No word from them until they are back at the gate.',
    kind: 'standard',
    grades: ['C', 'B+'],
    travelBand: 'furthest',
    // The full day, `MISSION_MAX_DURATION_MINUTES`, written out: this file is imported by the one
    // that declares it, and a value read back across that cycle is undefined at load.
    durationMinutes: 24 * 60,
    spoils: { caps: 15, supplies: 15, oil: 11, scrap: 18, planks: 15, highQualityMetal: 2 },
    leanings: ['road', 'haul', 'salvage'],
  },

  // --- the wider board ---------------------------------------------------------------------
  //
  // Nine jobs meant every area drew from almost the whole catalogue and two boards a district
  // apart looked much the same. What follows fills it out to something a player can read as a
  // city: work at every distance band and both kinds, so a three-card board is a
  // choice rather than a sample of the whole list.
  {
    id: 'water-run',
    name: 'Water Run',
    brief:
      'A standpipe two streets over runs clean for about an hour after the pumps cycle. Bring every drum you own and somebody to watch the corner.',
    kind: 'standard',
    grades: ['F-', 'F+'],
    travelBand: 'close',
    durationMinutes: 8,
    spoils: { supplies: 83, caps: 25 },
    leanings: ['haul', 'road'],
  },
  {
    id: 'cable-strip',
    name: 'Cable Strip',
    brief:
      'Half a block of Combine conduit nobody has pulled yet, because the ceiling above it is not holding much. Copper all the way down.',
    kind: 'standard',
    grades: ['F', 'E-'],
    travelBand: 'close',
    durationMinutes: 18,
    spoils: { scrap: 61, highQualityMetal: 2 },
    leanings: ['salvage', 'stealth', 'climb'],
  },
  {
    id: 'timber-pull',
    name: 'Timber Pull',
    brief:
      'The old market hall is coming down whether anybody helps it or not. Take the joists before it decides for itself.',
    kind: 'standard',
    grades: ['F-', 'E-'],
    travelBand: 'close',
    durationMinutes: 22,
    spoils: { planks: 56, scrap: 12 },
    leanings: ['haul', 'salvage', 'repair'],
  },
  {
    id: 'checkpoint-shakedown',
    name: 'Checkpoint Shakedown',
    brief:
      'A two-man Combine post on a road nobody official uses. They will not radio it in, because they are not supposed to be there either.',
    kind: 'battle',
    grades: ['F+', 'E'],
    travelBand: 'close',
    durationMinutes: 15,
    spoils: { caps: 78, scrap: 47 },
    leanings: ['fight'],
  },
  {
    id: 'debt-collection',
    name: 'Debt Collection',
    brief:
      'Somebody owes a broker and the broker is paying to have it explained to them. Nothing about this is complicated.',
    kind: 'battle',
    grades: ['F-', 'F+'],
    travelBand: 'close',
    durationMinutes: 20,
    spoils: { caps: 163 },
    leanings: ['fight'],
  },
  {
    id: 'pump-house',
    name: 'The Pump House',
    brief:
      'The Combine meters the water pressure for four blocks out of one pump house, and it has a garrison in it for exactly that reason.',
    kind: 'battle',
    grades: ['D', 'C-'],
    travelBand: 'further',
    durationMinutes: 55,
    spoils: { caps: 61, supplies: 53, scrap: 30 },
    leanings: ['fight'],
  },
  {
    id: 'relay-sabotage',
    /*
     * A relay mast taken off the air. It used to lean on `wire` beside the fight, for the cabinet
     * somebody has to know how to open; a fight leans on the fight alone now (see the note at the
     * head of this file), and the cabinet is flavour.
     */
    name: 'Relay Sabotage',
    brief:
      'One Combine relay mast, one night, and a district that stops being watched for a week afterwards. They will rebuild it. Let them.',
    kind: 'battle',
    grades: ['D+', 'C'],
    travelBand: 'further',
    durationMinutes: 70,
    spoils: { highQualityMetal: 10, scrap: 36, caps: 24 },
    leanings: ['fight'],
  },
  {
    id: 'archive-lift',
    name: 'Archive Lift',
    brief:
      'A Combine records office that still has power and a clerk who has stopped caring. Walk out with the drives, not the argument.',
    kind: 'standard',
    grades: ['D-', 'C-'],
    travelBand: 'further',
    durationMinutes: 80,
    spoils: { caps: 107, highQualityMetal: 7 },
    leanings: ['intel', 'stealth', 'haul'],
  },
  {
    id: 'ration-escort',
    name: 'Ration Escort',
    brief:
      'The Combine wants its own convoy walked through ground it has stopped policing. Good pay. Everybody on that road will see whose side you took.',
    kind: 'battle',
    grades: ['E', 'E+'],
    travelBand: 'further',
    durationMinutes: 65,
    spoils: { caps: 99, supplies: 35 },
    leanings: ['fight'],
  },
  {
    id: 'census-sweep',
    name: 'Census Sweep',
    brief:
      'Knock on every door on a list and write down who answers. The Combine will not say what the list is for and you already know.',
    kind: 'standard',
    grades: ['F+', 'E'],
    travelBand: 'close',
    durationMinutes: 35,
    spoils: { caps: 131 },
    leanings: ['talk', 'intel', 'con'],
  },
  {
    id: 'tunnel-survey',
    name: 'Tunnel Survey',
    brief:
      'Nobody has mapped the service tunnels since the flood and half of them go somewhere useful. Take rope. Take somebody who can swim.',
    kind: 'standard',
    grades: ['D', 'C'],
    travelBand: 'further',
    durationMinutes: 120,
    spoils: { scrap: 36, planks: 27, caps: 15 },
    leanings: ['road', 'intel', 'repair'],
  },
  {
    id: 'scrapworks-raid',
    name: 'Scrapworks Raid',
    brief:
      'A yard with a working press and forty people who would rather keep it. Loud, close, and worth every minute of it.',
    kind: 'battle',
    grades: ['D-', 'D+'],
    travelBand: 'further',
    durationMinutes: 100,
    spoils: { scrap: 51, highQualityMetal: 4, caps: 17 },
    leanings: ['fight'],
  },
  {
    id: 'spire-courier',
    name: 'Spire Courier',
    brief:
      'A sealed Combine case, up the lift, into a lobby with real air in it. You will be searched twice. Do not be carrying anything.',
    kind: 'standard',
    grades: ['D+', 'C+'],
    travelBand: 'furthest',
    durationMinutes: 200,
    spoils: { caps: 97, highQualityMetal: 4 },
    leanings: ['road', 'talk', 'con'],
  },
  {
    id: 'hydro-farm-strike',
    name: 'Hydro Farm Strike',
    brief:
      'Combine growing decks, four floors of them, lit around the clock. Take what will travel and put the lights out on the way past.',
    kind: 'battle',
    grades: ['C', 'C+'],
    travelBand: 'furthest',
    durationMinutes: 300,
    spoils: { supplies: 105, oil: 22, caps: 30 },
    leanings: ['fight'],
  },
  {
    id: 'blacksite-probe',
    name: 'Blacksite Probe',
    brief:
      'Get close enough to the Combine fence to see what is behind it and get back out again. Nobody has managed the second half yet.',
    kind: 'standard',
    grades: ['C', 'B'],
    travelBand: 'furthest',
    durationMinutes: 420,
    spoils: { highQualityMetal: 10, caps: 48, scrap: 17 },
    leanings: ['stealth', 'intel', 'road'],
  },

  // --- the 2026-09 intake -------------------------------------------------------------------
  //
  // Twenty-four jobs still meant a board of three was drawing from a pool small enough that a
  // player working two districts saw the same card twice in a morning. These fourteen widen the
  // shapes rather than the count: a rescue, an escort, a sabotage nobody is guarding, a crawl
  // through flooded plant rooms, a siege that runs eleven hours, and errands short enough to fit
  // between two builds. They also fill the holes the old list had: one easy fight for a crew with
  // nobody on the books, and long work that does not need an officer.
  {
    id: 'glass-pull',
    name: 'Glass Pull',
    brief:
      'The arcade roof let go in the night and left a hundred metres of frame lying in the street. Get there before the glaziers do.',
    kind: 'standard',
    grades: ['F-', 'F+'],
    travelBand: 'close',
    durationMinutes: 6,
    spoils: { planks: 50, scrap: 15 },
    leanings: ['salvage', 'haul'],
  },
  {
    id: 'ledger-errand',
    name: 'Ledger Errand',
    brief:
      'A Combine clerk needs a ledger walked four streets to an office with a working stamp. In and out, and nobody has to know you did it.',
    kind: 'standard',
    grades: ['F-', 'E-'],
    travelBand: 'close',
    durationMinutes: 9,
    spoils: { caps: 108, supplies: 13 },
    leanings: ['talk', 'intel'],
  },
  {
    id: 'gate-duty',
    name: 'Gate Duty',
    brief:
      'The Combine is a shift short on a service gate and will pay anybody who can stand in it. You will be turning your own neighbours back.',
    kind: 'battle',
    grades: ['F-', 'F+'],
    travelBand: 'close',
    durationMinutes: 24,
    // The one fight on the board a crew with nobody on the books can take, and it is the Combine's.
    spoils: { caps: 104, supplies: 21 },
    leanings: ['fight'],
  },
  {
    id: 'water-cart-escort',
    name: 'Water Cart Escort',
    brief:
      'Combine meter crews have started stopping the water carts on the ramp. Walk this one up and they will find somewhere else to be.',
    kind: 'battle',
    grades: ['F', 'E-'],
    travelBand: 'close',
    durationMinutes: 28,
    spoils: { supplies: 92, caps: 53 },
    leanings: ['fight'],
  },
  {
    id: 'meter-round',
    name: 'Meter Round',
    brief:
      'The Combine wants its air meters read on four blocks it no longer walks. Read them honestly and everybody on that stair pays for it.',
    kind: 'standard',
    grades: ['F', 'E'],
    travelBand: 'further',
    durationMinutes: 30,
    spoils: { caps: 85, supplies: 32 },
    leanings: ['talk', 'wire', 'repair'],
  },
  {
    id: 'tower-strip',
    /*
     * Aerial gear off a signal mast: `salvage` and `haul` are what it is, and the wire is what makes it
     * worth sending a Signals officer rather than whoever is free.
     *
     * Written out rather than derived, so the derived set this replaces (`leaningsFor`) is
     * spelled here in full: authoring the extra one alone would silently drop the rest.
     */
    name: 'Tower Strip',
    brief:
      'The signal tower on the co-op roof has been leaning since the storm, and the aerial gear on it is worth more than the tower. Climb light.',
    kind: 'standard',
    grades: ['E+', 'D+'],
    travelBand: 'close',
    durationMinutes: 45,
    spoils: { highQualityMetal: 9, scrap: 27 },
    leanings: ['climb', 'salvage', 'wire'],
  },
  {
    id: 'holding-pen-break',
    /*
     * Nineteen people out of a Combine yard, and nobody comes out of one of those walking. The fight
     * gets in; medicine is what decides how many of them are still alive at the gate.
     *
     * Written out rather than derived, so the derived set this replaces (`leaningsFor`) is
     * spelled here in full: authoring the extra one alone would silently drop the rest.
     */
    name: 'Holding Pen Break',
    brief:
      'The Combine is holding nineteen people in a yard behind the depot until somebody signs for them. Go and sign for them.',
    kind: 'battle',
    grades: ['C-', 'C+'],
    travelBand: 'further',
    durationMinutes: 50,
    // Nobody pays for a rescue. What comes home is what nineteen families put together for it.
    spoils: { caps: 120, supplies: 66 },
    leanings: ['fight'],
  },
  {
    id: 'rail-cut',
    name: 'Rail Cut',
    brief:
      'Six charges under a Combine freight line and the ore stops moving for a fortnight. Nobody is guarding it, which is the only easy part.',
    kind: 'standard',
    grades: ['D-', 'C-'],
    travelBand: 'further',
    durationMinutes: 65,
    spoils: { scrap: 51, oil: 26, caps: 21 },
    leanings: ['breach', 'stealth', 'haul'],
  },
  {
    id: 'armoury-raid',
    name: 'Armoury Raid',
    brief:
      'A Combine district armoury with one road in and a duty roster that thins after midnight. Take the racks and be out before the relief comes.',
    kind: 'battle',
    grades: ['B-', 'B+'],
    travelBand: 'further',
    durationMinutes: 75,
    spoils: { highQualityMetal: 12, caps: 40, scrap: 20 },
    leanings: ['fight'],
  },
  {
    id: 'tanker-ditch',
    name: 'Tanker Ditch',
    brief:
      'A fuel tanker went into the culvert some time last week and is still mostly full. It is also still leaking, so go today.',
    kind: 'standard',
    grades: ['E+', 'D+'],
    travelBand: 'further',
    durationMinutes: 95,
    spoils: { oil: 67, scrap: 13 },
    leanings: ['haul', 'repair', 'salvage'],
  },
  {
    id: 'sublevel-crawl',
    name: 'Sublevel Crawl',
    brief:
      'An afternoon on your belly through flooded plant rooms, cutting out whatever the water has not finished. Take lamps and rope.',
    kind: 'standard',
    grades: ['D-', 'C'],
    travelBand: 'further',
    durationMinutes: 150,
    spoils: { scrap: 31, planks: 26, highQualityMetal: 3 },
    leanings: ['salvage', 'climb', 'medic'],
  },
  {
    id: 'outer-sheds',
    name: 'The Outer Sheds',
    brief:
      'Machine sheds past the last checkpoint that nobody has bothered to strip, because of the walk. It is a long walk. That is the difficulty.',
    kind: 'standard',
    grades: ['E-', 'D-'],
    travelBand: 'furthest',
    durationMinutes: 240,
    // Four hours out and still easy: difficulty is about who is shooting, not how far it is.
    spoils: { planks: 28, scrap: 28, supplies: 19 },
    leanings: ['road', 'salvage', 'haul'],
  },
  {
    id: 'outpost-siege',
    /*
     * Eleven hours on a road outpost with a relief column coming. The longest fight on the board, so it
     * is the one that most wants somebody who can keep the wounded.
     *
     * Written out rather than derived, so the derived set this replaces (`leaningsFor`) is
     * spelled here in full: authoring the extra one alone would silently drop the rest.
     */
    name: 'Outpost Siege',
    brief:
      'Sit on a Combine road outpost until the garrison runs out of water. It takes all day, and the relief column is the part nobody plans for.',
    kind: 'battle',
    grades: ['A-', 'A+'],
    travelBand: 'furthest',
    durationMinutes: 660,
    spoils: { highQualityMetal: 9, oil: 30, caps: 35, scrap: 15 },
    leanings: ['fight'],
  },
  {
    id: 'reservoir-expedition',
    name: 'Reservoir Expedition',
    brief:
      'Out to the high reservoir and back, on the word of one man who says the pumping station still has stores in it. Pack for the night.',
    kind: 'standard',
    grades: ['C-', 'B-'],
    travelBand: 'furthest',
    durationMinutes: 720,
    spoils: { supplies: 40, oil: 25, caps: 20, scrap: 15 },
    leanings: ['road', 'haul', 'medic'],
  },
];
