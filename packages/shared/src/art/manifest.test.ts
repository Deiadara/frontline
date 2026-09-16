import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from '../building/index.js';
import { CITY_DISTRICTS, DISTRICT_KINDS } from '../city/index.js';
import { OVERSEER_ARCHETYPES } from '../overseer.js';
import { OVERSEER_PORTRAIT_IDS } from '../roles.js';
import { RESOURCE_KEYS } from '../resources.js';
import { UNIT_CATALOG, UNIT_TIER_LABELS } from '../units/index.js';
import {
  ART_MANIFEST,
  ASSET_CLASS_SPECS,
  AssetSpecSchema,
  backendCanProduce,
  backendsForSource,
  findAssetSpec,
  parseAssetFileName,
  postProcessFor,
  resolveAssetKey,
  STYLE_REFERENCE_KEYS,
  subjectResolvesToDomainId,
  tryResolveAssetKey,
  validateAssetSpec,
  type AssetSource,
  type AssetSpec,
} from './manifest.js';
import { FRAMING, NEGATIVE, PLATE_SUBJECTS, STYLE_ANCHOR } from './prompts.js';

/**
 * Transcribed from `docs/ART-PROMPTS.md` §1-§6. The manifest derives these from the domain
 * constants; this table is the independent copy that catches a derivation going wrong.
 */
const EXPECTED: readonly (readonly [key: string, file: string, seed: number])[] = [
  ['portrait-overseer-1', 'portrait-overseer-1.webp', 110001],
  ['portrait-overseer-2', 'portrait-overseer-2.webp', 110002],
  ['portrait-overseer-3', 'portrait-overseer-3.webp', 110003],
  ['portrait-overseer-4', 'portrait-overseer-4.webp', 110004],
  ['portrait-overseer-01', 'portrait-overseer-01.webp', 111001],
  ['portrait-overseer-02', 'portrait-overseer-02.webp', 111002],
  ['portrait-overseer-03', 'portrait-overseer-03.webp', 111003],
  ['portrait-overseer-04', 'portrait-overseer-04.webp', 111004],
  ['portrait-overseer-05', 'portrait-overseer-05.webp', 111005],
  ['portrait-overseer-06', 'portrait-overseer-06.webp', 111006],
  ['portrait-overseer-07', 'portrait-overseer-07.webp', 111007],
  ['portrait-overseer-08', 'portrait-overseer-08.webp', 111008],
  ['portrait-overseer-09', 'portrait-overseer-09.webp', 111009],
  ['portrait-overseer-10', 'portrait-overseer-10.webp', 111010],
  ['portrait-overseer-11', 'portrait-overseer-11.webp', 111011],
  ['portrait-overseer-12', 'portrait-overseer-12.webp', 111012],
  ['portrait-overseer-13', 'portrait-overseer-13.webp', 111013],
  ['portrait-overseer-14', 'portrait-overseer-14.webp', 111014],
  ['portrait-overseer-15', 'portrait-overseer-15.webp', 111015],
  ['portrait-overseer-16', 'portrait-overseer-16.webp', 111016],
  ['portrait-overseer-17', 'portrait-overseer-17.webp', 111017],
  ['portrait-overseer-18', 'portrait-overseer-18.webp', 111018],
  ['portrait-overseer-19', 'portrait-overseer-19.webp', 111019],
  ['portrait-overseer-20', 'portrait-overseer-20.webp', 111020],
  ['portrait-overseer-21', 'portrait-overseer-21.webp', 111021],
  ['portrait-overseer-22', 'portrait-overseer-22.webp', 111022],
  ['portrait-overseer-23', 'portrait-overseer-23.webp', 111023],
  ['portrait-overseer-24', 'portrait-overseer-24.webp', 111024],
  ['portrait-overseer-25', 'portrait-overseer-25.webp', 111025],
  ['portrait-overseer-26', 'portrait-overseer-26.webp', 111026],
  ['portrait-overseer-27', 'portrait-overseer-27.webp', 111027],
  ['portrait-overseer-28', 'portrait-overseer-28.webp', 111028],
  ['portrait-overseer-29', 'portrait-overseer-29.webp', 111029],
  ['portrait-overseer-30', 'portrait-overseer-30.webp', 111030],
  ['officer-01', 'officer-01.webp', 115001],
  ['officer-02', 'officer-02.webp', 115002],
  ['officer-03', 'officer-03.webp', 115003],
  ['officer-04', 'officer-04.webp', 115004],
  ['officer-05', 'officer-05.webp', 115005],
  ['officer-06', 'officer-06.webp', 115006],
  ['officer-07', 'officer-07.webp', 115007],
  ['officer-08', 'officer-08.webp', 115008],
  ['officer-09', 'officer-09.webp', 115009],
  ['officer-10', 'officer-10.webp', 115010],
  ['officer-11', 'officer-11.webp', 115011],
  ['officer-12', 'officer-12.webp', 115012],
  ['officer-13', 'officer-13.webp', 115013],
  ['officer-14', 'officer-14.webp', 115014],
  ['officer-15', 'officer-15.webp', 115015],
  ['officer-16', 'officer-16.webp', 115016],
  ['officer-17', 'officer-17.webp', 115017],
  ['officer-18', 'officer-18.webp', 115018],
  ['officer-19', 'officer-19.webp', 115019],
  ['officer-20', 'officer-20.webp', 115020],
  ['officer-21', 'officer-21.webp', 115021],
  ['officer-22', 'officer-22.webp', 115022],
  ['officer-23', 'officer-23.webp', 115023],
  ['officer-24', 'officer-24.webp', 115024],
  ['officer-25', 'officer-25.webp', 115025],
  ['officer-26', 'officer-26.webp', 115026],
  ['officer-27', 'officer-27.webp', 115027],
  ['officer-28', 'officer-28.webp', 115028],
  ['officer-29', 'officer-29.webp', 115029],
  ['officer-30', 'officer-30.webp', 115030],
  ['officer-31', 'officer-31.webp', 115031],
  ['officer-32', 'officer-32.webp', 115032],
  ['officer-33', 'officer-33.webp', 115033],
  ['officer-34', 'officer-34.webp', 115034],
  ['officer-35', 'officer-35.webp', 115035],
  ['officer-36', 'officer-36.webp', 115036],
  ['officer-37', 'officer-37.webp', 115037],
  ['officer-38', 'officer-38.webp', 115038],
  ['officer-39', 'officer-39.webp', 115039],
  ['officer-40', 'officer-40.webp', 115040],
  ['officer-41', 'officer-41.webp', 115041],
  ['officer-42', 'officer-42.webp', 115042],
  ['officer-43', 'officer-43.webp', 115043],
  ['officer-44', 'officer-44.webp', 115044],
  ['officer-45', 'officer-45.webp', 115045],
  ['officer-46', 'officer-46.webp', 115046],
  ['officer-47', 'officer-47.webp', 115047],
  ['officer-48', 'officer-48.webp', 115048],
  ['officer-49', 'officer-49.webp', 115049],
  ['officer-50', 'officer-50.webp', 115050],
  ['officer-51', 'officer-51.webp', 115051],
  ['officer-52', 'officer-52.webp', 115052],
  ['officer-53', 'officer-53.webp', 115053],
  ['officer-54', 'officer-54.webp', 115054],
  ['officer-55', 'officer-55.webp', 115055],
  ['officer-56', 'officer-56.webp', 115056],
  ['officer-57', 'officer-57.webp', 115057],
  ['officer-58', 'officer-58.webp', 115058],
  ['officer-59', 'officer-59.webp', 115059],
  ['officer-60', 'officer-60.webp', 115060],
  ['officer-61', 'officer-61.webp', 115061],
  ['officer-62', 'officer-62.webp', 115062],
  ['officer-63', 'officer-63.webp', 115063],
  ['officer-64', 'officer-64.webp', 115064],
  ['officer-65', 'officer-65.webp', 115065],
  ['officer-66', 'officer-66.webp', 115066],
  ['officer-67', 'officer-67.webp', 115067],
  ['officer-68', 'officer-68.webp', 115068],
  ['officer-69', 'officer-69.webp', 115069],
  ['officer-70', 'officer-70.webp', 115070],
  ['officer-71', 'officer-71.webp', 115071],
  ['officer-72', 'officer-72.webp', 115072],
  ['officer-73', 'officer-73.webp', 115073],
  ['officer-74', 'officer-74.webp', 115074],
  ['officer-75', 'officer-75.webp', 115075],
  ['officer-76', 'officer-76.webp', 115076],
  ['officer-77', 'officer-77.webp', 115077],
  ['officer-78', 'officer-78.webp', 115078],
  ['officer-79', 'officer-79.webp', 115079],
  ['officer-80', 'officer-80.webp', 115080],
  ['officer-81', 'officer-81.webp', 115081],
  ['officer-82', 'officer-82.webp', 115082],
  ['officer-83', 'officer-83.webp', 115083],
  ['officer-84', 'officer-84.webp', 115084],
  ['officer-85', 'officer-85.webp', 115085],
  ['officer-86', 'officer-86.webp', 115086],
  ['officer-87', 'officer-87.webp', 115087],
  ['officer-88', 'officer-88.webp', 115088],
  ['officer-89', 'officer-89.webp', 115089],
  ['officer-90', 'officer-90.webp', 115090],
  ['officer-91', 'officer-91.webp', 115091],
  ['officer-92', 'officer-92.webp', 115092],
  ['officer-93', 'officer-93.webp', 115093],
  ['officer-94', 'officer-94.webp', 115094],
  ['officer-95', 'officer-95.webp', 115095],
  ['officer-96', 'officer-96.webp', 115096],
  ['officer-97', 'officer-97.webp', 115097],
  ['officer-98', 'officer-98.webp', 115098],
  ['officer-99', 'officer-99.webp', 115099],
  ['officer-100', 'officer-100.webp', 115100],
  ['officer-101', 'officer-101.webp', 115101],
  ['officer-102', 'officer-102.webp', 115102],
  ['officer-103', 'officer-103.webp', 115103],
  ['officer-104', 'officer-104.webp', 115104],
  ['officer-105', 'officer-105.webp', 115105],
  ['officer-106', 'officer-106.webp', 115106],
  ['officer-107', 'officer-107.webp', 115107],
  ['officer-108', 'officer-108.webp', 115108],
  ['officer-109', 'officer-109.webp', 115109],
  ['officer-110', 'officer-110.webp', 115110],
  ['officer-111', 'officer-111.webp', 115111],
  ['officer-112', 'officer-112.webp', 115112],
  ['officer-113', 'officer-113.webp', 115113],
  ['officer-114', 'officer-114.webp', 115114],
  ['officer-115', 'officer-115.webp', 115115],
  ['officer-116', 'officer-116.webp', 115116],
  ['officer-117', 'officer-117.webp', 115117],
  ['officer-118', 'officer-118.webp', 115118],
  ['officer-119', 'officer-119.webp', 115119],
  ['officer-120', 'officer-120.webp', 115120],
  ['officer-121', 'officer-121.webp', 115121],
  ['officer-122', 'officer-122.webp', 115122],
  ['officer-123', 'officer-123.webp', 115123],
  ['officer-124', 'officer-124.webp', 115124],
  ['officer-125', 'officer-125.webp', 115125],
  ['officer-126', 'officer-126.webp', 115126],
  ['officer-127', 'officer-127.webp', 115127],
  ['officer-128', 'officer-128.webp', 115128],
  ['officer-129', 'officer-129.webp', 115129],
  ['officer-130', 'officer-130.webp', 115130],
  ['officer-131', 'officer-131.webp', 115131],
  ['officer-132', 'officer-132.webp', 115132],
  ['officer-133', 'officer-133.webp', 115133],
  ['officer-134', 'officer-134.webp', 115134],
  ['officer-135', 'officer-135.webp', 115135],
  ['officer-136', 'officer-136.webp', 115136],
  ['officer-137', 'officer-137.webp', 115137],
  ['officer-138', 'officer-138.webp', 115138],
  ['officer-139', 'officer-139.webp', 115139],
  ['officer-140', 'officer-140.webp', 115140],
  ['officer-141', 'officer-141.webp', 115141],
  ['officer-142', 'officer-142.webp', 115142],
  ['officer-143', 'officer-143.webp', 115143],
  ['officer-144', 'officer-144.webp', 115144],
  ['officer-145', 'officer-145.webp', 115145],
  ['officer-146', 'officer-146.webp', 115146],
  ['officer-147', 'officer-147.webp', 115147],
  ['officer-148', 'officer-148.webp', 115148],
  ['officer-149', 'officer-149.webp', 115149],
  ['officer-150', 'officer-150.webp', 115150],
  ['officer-151', 'officer-151.webp', 115151],
  ['officer-152', 'officer-152.webp', 115152],
  ['officer-153', 'officer-153.webp', 115153],
  ['officer-154', 'officer-154.webp', 115154],
  ['officer-155', 'officer-155.webp', 115155],
  ['officer-156', 'officer-156.webp', 115156],
  ['officer-157', 'officer-157.webp', 115157],
  ['officer-158', 'officer-158.webp', 115158],
  ['officer-159', 'officer-159.webp', 115159],
  ['officer-160', 'officer-160.webp', 115160],
  ['officer-161', 'officer-161.webp', 115161],
  ['officer-162', 'officer-162.webp', 115162],
  ['officer-163', 'officer-163.webp', 115163],
  ['officer-164', 'officer-164.webp', 115164],
  ['district-neon-docks', 'district-neon-docks.webp', 120001],
  ['district-ashen-terraces', 'district-ashen-terraces.webp', 120002],
  ['district-kettle-row', 'district-kettle-row.webp', 120003],
  ['district-rustyard', 'district-rustyard.webp', 120004],
  ['district-chrome-row', 'district-chrome-row.webp', 120005],
  ['district-undergrid', 'district-undergrid.webp', 120006],
  ['district-datavault-sigma', 'district-datavault-sigma.webp', 120007],
  ['district-glasshouse-fields', 'district-glasshouse-fields.webp', 120008],
  ['district-blacksite-7', 'district-blacksite-7.webp', 120009],
  ['district-combine-spire', 'district-combine-spire.webp', 120010],
  ['district-upper-roofs', 'district-upper-roofs.webp', 120011],
  ['district-south-quay', 'district-south-quay.webp', 120012],
  ['plate-city', 'plate-city.webp', 130001],
  ['plane-city-sky', 'plane-city-sky.webp', 130002],
  ['plane-city-far', 'plane-city-far.webp', 130003],
  ['plane-city-fore', 'plane-city-fore.webp', 130004],
  ['splash-auth', 'splash-auth.webp', 130005],
  ['plate-district', 'plate-district.webp', 130006],
  ['plate-bar', 'plate-bar.webp', 130007],
  ['plate-district-neon-docks', 'plate-district-neon-docks.webp', 130008],
  ['plate-district-rustyard', 'plate-district-rustyard.webp', 130009],
  ['plate-district-chrome-row', 'plate-district-chrome-row.webp', 130010],
  ['plate-faction-room', 'plate-faction-room.webp', 130011],
  ['plate-district-undergrid', 'plate-district-undergrid.webp', 130012],
  ['plate-district-datavault-sigma', 'plate-district-datavault-sigma.webp', 130013],
  ['plate-district-glasshouse-fields', 'plate-district-glasshouse-fields.webp', 130014],
  ['plate-district-blacksite-7', 'plate-district-blacksite-7.webp', 130015],
  ['building-nexus', 'building-nexus.webp', 140001],
  ['building-quarters', 'building-quarters.webp', 140002],
  ['building-greenhouse', 'building-greenhouse.webp', 140003],
  ['building-generator', 'building-generator.webp', 140004],
  ['building-scrapyard', 'building-scrapyard.webp', 140005],
  ['building-apothecary', 'building-apothecary.webp', 140006],
  ['building-gate', 'building-gate.webp', 140007],
  ['building-lab', 'building-lab.webp', 140008],
  ['building-gauntlet', 'building-gauntlet.webp', 140009],
  ['building-infirmary', 'building-infirmary.webp', 140010],
  ['building-garage', 'building-garage.webp', 140011],
  ['unit-razors', 'unit-razors.webp', 145001],
  ['unit-anodics', 'unit-anodics.webp', 145002],
  ['unit-sparks', 'unit-sparks.webp', 145003],
  ['unit-scrapers', 'unit-scrapers.webp', 145004],
  ['unit-breakers', 'unit-breakers.webp', 145005],
  ['unit-wardens', 'unit-wardens.webp', 145006],
  ['unit-ghosts', 'unit-ghosts.webp', 145007],
  ['unit-road-reavers', 'unit-road-reavers.webp', 145008],
  ['unit-ironsides', 'unit-ironsides.webp', 145009],
  ['unit-ash-walkers', 'unit-ash-walkers.webp', 145010],
  ['unit-snipers', 'unit-snipers.webp', 145011],
  ['unit-stitchers', 'unit-stitchers.webp', 145012],
  ['unit-demolishers', 'unit-demolishers.webp', 145013],
  ['unit-kite-crews', 'unit-kite-crews.webp', 145014],
  ['unit-netrunners', 'unit-netrunners.webp', 145015],
  ['unit-sleepers', 'unit-sleepers.webp', 145016],
  ['unit-cyber-dogs', 'unit-cyber-dogs.webp', 145017],
  ['unit-juggernauts', 'unit-juggernauts.webp', 145018],
  ['unit-hollow-men', 'unit-hollow-men.webp', 145019],
  ['unit-the-condemned', 'unit-the-condemned.webp', 145020],
  ['unit-the-specter', 'unit-the-specter.webp', 145021],
  ['unit-the-abomination', 'unit-the-abomination.webp', 145022],
  ['unit-the-colossus', 'unit-the-colossus.webp', 145023],
  ['unit-the-saint', 'unit-the-saint.webp', 145024],
  ['unit-the-cartographer', 'unit-the-cartographer.webp', 145025],
  ['unit-the-twins', 'unit-the-twins.webp', 145026],
  ['unit-scavengers', 'unit-scavengers.webp', 145027],
  ['unit-haulers', 'unit-haulers.webp', 145028],
  ['unit-the-crimson-dancer', 'unit-the-crimson-dancer.webp', 145029],
  ['unit-sluggers', 'unit-sluggers.webp', 145030],
  ['unit-the-loose-end', 'unit-the-loose-end.webp', 145031],
  ['ui-frame-panel', 'ui-frame-panel.png', 150001],
  ['ui-frame-modal', 'ui-frame-modal.png', 150002],
  ['ui-frame-hud', 'ui-frame-hud.png', 150003],
  ['ui-plate-button', 'ui-plate-button.png', 150004],
  ['ui-plate-nav', 'ui-plate-nav.png', 150005],
  ['ui-divider', 'ui-divider.png', 150006],
  ['icon-caps', 'icon-caps.webp', 160001],
  ['icon-supplies', 'icon-supplies.webp', 160002],
  ['icon-oil', 'icon-oil.webp', 160003],
  ['icon-scrap', 'icon-scrap.webp', 160004],
  ['icon-high-quality-metal', 'icon-high-quality-metal.webp', 160005],
  ['icon-planks', 'icon-planks.webp', 160006],
  ['icon-archetype-enforcer', 'icon-archetype-enforcer.webp', 160011],
  ['icon-archetype-netrunner', 'icon-archetype-netrunner.webp', 160012],
  ['icon-archetype-fixer', 'icon-archetype-fixer.webp', 160013],
  ['icon-archetype-technocrat', 'icon-archetype-technocrat.webp', 160014],
  ['icon-kind-residential', 'icon-kind-residential.webp', 160021],
  ['icon-kind-contested', 'icon-kind-contested.webp', 160022],
  ['icon-location-scrap-press', 'icon-location-scrap-press.webp', 160031],
  ['icon-location-chemical-plant', 'icon-location-chemical-plant.webp', 160032],
  ['icon-location-power-station', 'icon-location-power-station.webp', 160033],
  ['icon-location-water-works', 'icon-location-water-works.webp', 160034],
  ['icon-location-foundry', 'icon-location-foundry.webp', 160035],
  ['icon-location-gas-station', 'icon-location-gas-station.webp', 160036],
  ['icon-location-nuclear-plant', 'icon-location-nuclear-plant.webp', 160037],
  ['icon-location-soup-kitchen', 'icon-location-soup-kitchen.webp', 160038],
  ['icon-location-refugee-camp', 'icon-location-refugee-camp.webp', 160039],
  ['icon-location-market', 'icon-location-market.webp', 160040],
  ['icon-location-downtown-market', 'icon-location-downtown-market.webp', 160041],
  ['icon-location-pawn-shop', 'icon-location-pawn-shop.webp', 160042],
  ['icon-location-bone-market', 'icon-location-bone-market.webp', 160043],
  ['icon-location-revolutionist-statue', 'icon-location-revolutionist-statue.webp', 160044],
  ['icon-location-high-ground', 'icon-location-high-ground.webp', 160045],
  ['icon-location-barricade', 'icon-location-barricade.webp', 160046],
  ['icon-location-watchtower', 'icon-location-watchtower.webp', 160047],
  ['icon-location-sewer-junction', 'icon-location-sewer-junction.webp', 160048],
  ['icon-location-smugglers-tunnel', 'icon-location-smugglers-tunnel.webp', 160049],
  ['icon-location-armory', 'icon-location-armory.webp', 160050],
  ['icon-location-war-machine-graveyard', 'icon-location-war-machine-graveyard.webp', 160051],
  ['icon-location-construction-site', 'icon-location-construction-site.webp', 160052],
  ['icon-location-fight-pit', 'icon-location-fight-pit.webp', 160053],
  ['icon-location-gym', 'icon-location-gym.webp', 160054],
  ['icon-location-doghouse', 'icon-location-doghouse.webp', 160055],
  ['icon-location-rail-yard', 'icon-location-rail-yard.webp', 160056],
  ['icon-location-tram-depot', 'icon-location-tram-depot.webp', 160057],
  ['icon-location-university', 'icon-location-university.webp', 160058],
  ['icon-location-planetarium', 'icon-location-planetarium.webp', 160059],
  ['icon-location-satellite-uplink', 'icon-location-satellite-uplink.webp', 160060],
  ['icon-location-broadcast-tower', 'icon-location-broadcast-tower.webp', 160061],
  ['icon-location-broadcast-station', 'icon-location-broadcast-station.webp', 160062],
  ['icon-location-pirate-radio', 'icon-location-pirate-radio.webp', 160063],
  ['icon-location-gene-clinic', 'icon-location-gene-clinic.webp', 160064],
  ['icon-location-hospital', 'icon-location-hospital.webp', 160065],
  ['icon-location-black-clinic', 'icon-location-black-clinic.webp', 160066],
  ['icon-location-mad-scientist-lair', 'icon-location-mad-scientist-lair.webp', 160067],
  ['icon-location-tavern', 'icon-location-tavern.webp', 160068],
  ['icon-location-cinema', 'icon-location-cinema.webp', 160069],
  ['icon-location-arcade', 'icon-location-arcade.webp', 160070],
  ['icon-location-skate-ground', 'icon-location-skate-ground.webp', 160071],
  ['icon-location-chapel', 'icon-location-chapel.webp', 160072],
  ['icon-location-graveyard', 'icon-location-graveyard.webp', 160073],
  ['icon-location-revolutionary-statue', 'icon-location-revolutionary-statue.webp', 160074],
  ['icon-location-glasshouse', 'icon-location-glasshouse.webp', 160075],
  // §C1: the Garage's catalogue, appended after the location markers so no seed above moves.
  ['vehicle-motorcycle', 'vehicle-motorcycle.webp', 161001],
  ['vehicle-dirt-runner', 'vehicle-dirt-runner.webp', 161002],
  ['vehicle-scrap-car', 'vehicle-scrap-car.webp', 161003],
  ['vehicle-armoured-car', 'vehicle-armoured-car.webp', 161004],
  ['vehicle-gas-balloon', 'vehicle-gas-balloon.webp', 161005],
  ['vehicle-rotorcraft', 'vehicle-rotorcraft.webp', 161006],
  ['vehicle-heli-porter', 'vehicle-heli-porter.webp', 161007],
];

/**
 * `prompts.ts` is the only copy of every prompt and `docs/ART-PROMPTS.md` is a hand transcription
 * of it, so the two drift silently. These parse the doc back out; `block()` collapses whitespace
 * before a prompt ever reaches a backend, so the comparison is after collapsing, not line-for-line.
 */
const PROMPT_DOC = readFileSync(
  fileURLToPath(new URL('../../../../docs/ART-PROMPTS.md', import.meta.url)),
  'utf8',
);

/**
 * §1-§5: a per-asset heading, then a fenced `SUBJECT:` block.
 *
 * The section number takes a letter (`1b.7`) as well as digits. The officer pool sits beside the
 * overseer portraits rather than at the end of the document, because that is where a reader looks
 * for a face, and a digits-only pattern skipped all forty-three of them in silence: the doc had
 * the subjects, the scan did not see them, and the only symptom was the count.
 */
const FENCED_SUBJECT = /^### [\da-z.]+ `([a-z\d-]+)`[^\n]*\n+```\n(SUBJECT:[\s\S]*?)\n```/gm;

/** §6 instead tabulates the thirteen icons: ``| `icon-caps` | … | `SUBJECT: …` |``. */
const TABLE_SUBJECT = /^\| `([a-z\d-]+)` *\|[^\n]*`(SUBJECT:[^`]*)`/gm;
/** §7's index row: key, unit name, tier label, seed. */
const UNIT_INDEX_ROW = /^\| `(unit-[a-z\d-]+)` *\| ([^|]+)\| ([^|]+)\| `(\d+)` *\|/gm;

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');

const documentedSubjects = new Map(
  [...PROMPT_DOC.matchAll(FENCED_SUBJECT), ...PROMPT_DOC.matchAll(TABLE_SUBJECT)].map(
    // Both groups always match; the defaults only satisfy `noUncheckedIndexedAccess`, and an
    // empty key or subject would fail the assertions below rather than pass silently.
    ([, key = '', subject = '']) => [key, collapse(subject.slice('SUBJECT:'.length))] as const,
  ),
);

/** Where each class's framing lives. Typed off `FRAMING`, so a new class cannot skip the check. */
const FRAMING_SECTIONS: Readonly<Record<keyof typeof FRAMING, string>> = {
  portrait: '## 1. ',
  officer: '## 1b. ',
  district: '## 2. ',
  plate: '## 3. ',
  building: '## 4. ',
  ui: '## 5. ',
  icon: '## 6. ',
  vehicle: '## 6b. ',
  unit: '## 7. ',
};

/** The shared and per-class blocks are the first fence under their heading rather than keyed. */
const documentedBlock = (heading: string): string => {
  const section = PROMPT_DOC.slice(PROMPT_DOC.indexOf(`\n${heading}`));
  const body = /```\n([\s\S]*?)\n```/.exec(section)?.[1];
  if (body === undefined) throw new Error(`No fenced block under "${heading}" in ART-PROMPTS.md`);
  return collapse(body);
};

const districtSpec = (): AssetSpec => {
  const spec = findAssetSpec('district-neon-docks');
  if (!spec) throw new Error('district-neon-docks is missing from the manifest');
  return spec;
};

describe('ART_MANIFEST', () => {
  it('matches the ART-PROMPTS asset list exactly, in order', () => {
    expect(ART_MANIFEST.map((spec) => [spec.key, spec.file, spec.seed])).toEqual(
      EXPECTED.map((row) => [...row]),
    );
  });

  it('holds the 337 MVP assets', () => {
    expect(ART_MANIFEST).toHaveLength(337);
  });

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec] as const))(
    '%s parses its schema',
    (_, spec) => {
      expect(() => AssetSpecSchema.parse(spec)).not.toThrow();
    },
  );

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec] as const))(
    '%s satisfies the ART-BIBLE rules',
    (_, spec) => {
      expect(validateAssetSpec(spec)).toEqual([]);
    },
  );

  it('has unique keys, filenames and seeds', () => {
    const keys = ART_MANIFEST.map((spec) => spec.key);
    const files = ART_MANIFEST.map((spec) => spec.file);
    const seeds = ART_MANIFEST.map((spec) => spec.seed);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(files).size).toBe(files.length);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  /**
   * The district plate is the sole asset off its class size, and it is listed here rather than
   * skipped, so a second one drifting off the table is a failure with a name in it, not a silently
   * widened rule.
   */
  const SIZE_EXCEPTIONS: Record<string, { width: number; height: number; aspect: string }> = {
    // The thirty overseer portraits, first in manifest order and the only exception that is not a
    // plate. Not load-bearing the way the plates below are, because nothing is positioned on them;
    // listed for the other half of the rule, that an asset off its class size is named. 928x1392
    // is the largest 2:3 crop the 1122x1402 masters supply with both sides divisible by 16.
    'portrait-overseer-01': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-02': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-03': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-04': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-05': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-06': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-07': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-08': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-09': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-10': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-11': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-12': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-13': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-14': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-15': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-16': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-17': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-18': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-19': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-20': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-21': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-22': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-23': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-24': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-25': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-26': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-27': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-28': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-29': { width: 928, height: 1392, aspect: '3:4' },
    'portrait-overseer-30': { width: 928, height: 1392, aspect: '3:4' },
    // The city, at the size the maintainer painted it. Load-bearing the same way the district plate is:
    // the ten district tags on `/game` are positioned as fractions of this exact image, so a
    // district slides off the roof it names if the delivery size changes under it.
    'plate-city': { width: 3780, height: 1800, aspect: '21:10' },
    // The size the maintainer painted it at. Written down independently of the manifest on purpose:
    // this is the one asset whose delivery size is *load-bearing*: twelve building outlines are
    // positions on this exact image, so a change to it has to be made in two places by somebody
    // who meant it, rather than in one and agreed with automatically.
    'plate-district': { width: 3780, height: 1800, aspect: '21:10' },
    // And the Bar's room, for the same reason: the Sit Down control is positioned as a fraction of
    // this exact image, so the empty stool moves out from under it if the delivery size changes.
    'plate-bar': { width: 1926, height: 817, aspect: '2.36:1' },
    // The two contested districts, and the same reasoning a third time: seven location signs are
    // positioned as fractions of each of these exact images, so a delivery that changes shape moves
    // all seven and has to be agreed to here as well as in the manifest.
    // Both started at 1672x941 and 16:9. The Docks were repainted to the 21:10 the city and the
    // home district are on; the Steelbelt went to 2.36:1 for a while and has since been redelivered
    // at the same 21:10. Two numbers rather than one shared constant even so, because they have
    // moved independently before and will again.
    'plate-district-neon-docks': { width: 3780, height: 1800, aspect: '21:10' },
    'plate-district-rustyard': { width: 3780, height: 1800, aspect: '21:10' },
    'plate-district-chrome-row': { width: 3780, height: 1800, aspect: '21:10' },
    // The faction's back room, at the same shape: five seats are fractions of this exact image.
    'plate-faction-room': { width: 3780, height: 1800, aspect: '21:10' },
    // The Undergrid, after the room in manifest order: seven signs and a gate sit on this image.
    'plate-district-undergrid': { width: 3780, height: 1800, aspect: '21:10' },
    // The Annexes, last in manifest order and the one plate off the other four's size: the board's
    // file is named 3780x1800 and measures 1817x866. Wired at the measurement, so this number is
    // the one place a re-export at the full width has to be agreed to a second time.
    'plate-district-datavault-sigma': { width: 1817, height: 866, aspect: '21:10' },
    // Glasshouse Fields and the Blacksite, delivered together on 2026-09-15 and both measured at
    // the full 3780x1800: seven signs and a gate stand on the first, eight and a gate on the second.
    'plate-district-glasshouse-fields': { width: 3780, height: 1800, aspect: '21:10' },
    'plate-district-blacksite-7': { width: 3780, height: 1800, aspect: '21:10' },
  };

  it('matches the ART-BIBLE §6 resolution and aspect table per class', () => {
    const off: string[] = [];
    for (const spec of ART_MANIFEST) {
      const classSpec = ASSET_CLASS_SPECS[spec.class];
      const size = { width: spec.width, height: spec.height, aspect: spec.aspect as string };
      const expected = SIZE_EXCEPTIONS[spec.key] ?? {
        width: classSpec.width,
        height: classSpec.height,
        aspect: classSpec.aspect,
      };
      expect(size, spec.key).toEqual(expected);
      if (SIZE_EXCEPTIONS[spec.key]) off.push(spec.key);
    }
    // Every declared exception is real: an entry left behind for an asset that has gone back to its
    // class size would quietly stop protecting anything.
    expect(off).toEqual(Object.keys(SIZE_EXCEPTIONS));
  });

  it('carries the ART-BIBLE §6 delivery format and quality per class', () => {
    // Hand-transcribed from the §6 table; PNG classes are lossless and carry no quality.
    expect(
      Object.fromEntries(
        Object.entries(ASSET_CLASS_SPECS).map(([name, s]) => [name, `${s.ext}${s.quality ?? ''}`]),
      ),
    ).toEqual({
      portrait: 'webp90',
      // A roster face at a couple of hundred pixels: 88 rather than 90, times forty-three.
      officer: 'webp88',
      district: 'webp90',
      plate: 'webp92',
      plane: 'webp90',
      building: 'webp90',
      unit: 'webp90',
      // §C1: a machine on a card, the same format a district plate ships in.
      vehicle: 'webp90',
      ui: 'png',
      icon: 'webp88',
      splash: 'webp90',
      lut: 'png',
    });
  });

  it('marks the sky plane opaque and the other planes alpha', () => {
    expect(findAssetSpec('plane-city-sky')?.alpha).toBe(false);
    expect(findAssetSpec('plane-city-far')?.alpha).toBe(true);
    expect(findAssetSpec('plane-city-fore')?.alpha).toBe(true);
  });

  it('gives every asset the two reference images except those generated before them', () => {
    const unreferenced = ART_MANIFEST.filter((spec) => spec.styleRefs.length === 0).map(
      (s) => s.key,
    );
    expect(unreferenced).toEqual([
      'portrait-overseer-1',
      'district-neon-docks',
      'plate-city',
      'plane-city-sky',
      'plane-city-far',
      'plane-city-fore',
    ]);
    for (const spec of ART_MANIFEST) {
      if (spec.styleRefs.length > 0) expect(spec.styleRefs).toEqual([...STYLE_REFERENCE_KEYS]);
    }
  });

  /**
   * Split by size rather than by taste. §6.6 routes faces to gpt-image-1, and the four heroes it
   * was written for are 1024x1536, which gpt-image-1 renders. The thirty are 928x1392, which it
   * does not: it takes exactly three sizes. So the pin on them records the only backend that
   * *could* have produced them, which is the same thing the officer pool's pin records.
   */
  it('routes the four hero portraits to gpt-image-1 per ADR 0001 §6.6', () => {
    const portraits = ART_MANIFEST.filter((spec) => spec.class === 'portrait');
    const heroes = portraits.filter((spec) => /^portrait-overseer-\d$/.test(spec.key));
    const pool = portraits.filter((spec) => /^portrait-overseer-\d\d$/.test(spec.key));
    expect([heroes.length, pool.length]).toEqual([4, 30]);
    expect(heroes.length + pool.length).toBe(portraits.length);
    for (const spec of heroes) expect(spec.backend, spec.key).toBe('openai');
    for (const spec of pool) expect(spec.backend, spec.key).toBe('fal');
  });

  /** The acceptance criterion of MOU-123: no manifest entry may be unbuildable. */
  it('gives every asset at least one backend that can render its source', () => {
    for (const spec of ART_MANIFEST) {
      expect(backendsForSource(spec.source), spec.key).not.toEqual([]);
    }
  });

  it('pins a backend exactly when only one can render the asset, and never a wrong one', () => {
    for (const spec of ART_MANIFEST) {
      const capable = backendsForSource(spec.source);
      if (spec.backend === undefined) {
        expect(capable.length, spec.key).toBeGreaterThan(1);
      } else {
        expect(capable, spec.key).toContain(spec.backend);
        // Portraits are pinned for quality (ADR 0001 §6.6); everything else for capability.
        if (capable.length > 1) expect(spec.class).toBe('portrait');
      }
    }
  });

  it('renders icons at 1024² and downscales: nothing produces 512² with alpha', () => {
    for (const spec of ART_MANIFEST.filter((s) => s.class === 'icon')) {
      expect(spec, spec.key).toMatchObject({
        width: 512,
        height: 512,
        alpha: true,
        source: { width: 1024, height: 1024, alpha: true },
        postProcess: ['downscale'],
        backend: 'openai',
      });
    }
  });

  it('renders the alpha planes opaque and mattes them: nothing produces 16:9 with alpha', () => {
    for (const key of ['plane-city-far', 'plane-city-fore']) {
      expect(findAssetSpec(key), key).toMatchObject({
        alpha: true,
        source: { width: 2048, height: 1152, alpha: false },
        postProcess: ['matte'],
        backend: 'fal',
      });
    }
    // The sky plane already ships opaque, so its master is the delivery image.
    expect(findAssetSpec('plane-city-sky')).toMatchObject({ postProcess: [] });
  });

  it('mattes exactly the two planes and the buildings ART-BIBLE §6.2 keys', () => {
    // §6.2's stroke floor is scoped to the keyed assets, which is why it does not contradict
    // §3.2's rim allowance. A third matted asset silently widens that scope: trip the doc first.
    // Buildings joined the keyed set: a delivered master arrives painted on flat white (§6.3), so
    // the class source is declared opaque and the key is the normal path rather than an exception.
    expect(
      ART_MANIFEST.filter((spec) => spec.postProcess.includes('matte')).map((spec) => spec.key),
    ).toEqual([
      'plane-city-far',
      'plane-city-fore',
      ...ART_MANIFEST.filter((spec) => spec.class === 'building').map((spec) => spec.key),
    ]);
  });

  it('names the ART-BIBLE §6.3 key field in both matted prompts, and asks no backend for alpha', () => {
    // The backend cannot emit alpha, so a matted prompt that says "transparent background" leaves the
    // field colour to the model, and a night-sky field lands inside the separation the erasure gate
    // needs to see anything at all. Naming `#ff00ff` is what makes §6.3 satisfiable at all.
    for (const key of ['plane-city-far', 'plane-city-fore'] as const) {
      const subject = PLATE_SUBJECTS[key];
      expect(subject, key).toContain('#ff00ff');
      expect(subject, key).not.toContain('transparent');
    }
  });

  it('carries the ART-BIBLE §6 transparency floors on both matted planes', () => {
    expect(findAssetSpec('plane-city-far')?.minTransparency).toBe(0.3);
    expect(findAssetSpec('plane-city-fore')?.minTransparency).toBe(0.55);
    // §6 names a floor for the planes only; every other asset leaves the gate to the matte checks.
    expect(
      ART_MANIFEST.filter((spec) => spec.minTransparency !== undefined).map((spec) => spec.key),
    ).toEqual(['plane-city-far', 'plane-city-fore']);
  });

  it('leaves the rest of the manifest needing no post-process at all', () => {
    /*
     * 282 in the manifest, 70 of them post-processed.
     *
     * Both figures move together whenever a subject is added or removed. It was 76: §C1's eight
     * machines were drafted as icons, which are rendered at 1024² and downscaled, and they are
     * their own `vehicle` class now, delivered at the size they are painted. A class whose source
     * and delivery agree needs no step at all, which is the whole reason `postProcess` is derived
     * rather than written down.
     */
    expect(ART_MANIFEST.filter((spec) => spec.postProcess.length > 0)).toHaveLength(70);
  });

  it('carries the shared prompt blocks as single-line prose', () => {
    for (const text of [STYLE_ANCHOR, NEGATIVE]) {
      expect(text).not.toMatch(/\s{2,}|\n/);
    }
    expect(STYLE_ANCHOR).toContain('#22d3ee');
    expect(NEGATIVE).toContain('cel shading');
  });
});

describe('docs/ART-PROMPTS.md transcribes prompts.ts', () => {
  /**
   * §7's index table, checked against the roster it is an index *of*.
   *
   * Nothing checked it, and it drifted three ways at once without a single test going red: it still
   * filed six units under a tier that no longer exists, still called two units by names they had
   * been renamed from, and its whole seed column was off by one after a unit was removed from the
   * middle of the catalogue. The subject sections below were covered and the table above them was
   * not, which is the more dangerous half: a seed is what regenerates an asset.
   */
  it('indexes every unit with the name, tier and seed the code gives it', () => {
    const documented = [...PROMPT_DOC.matchAll(UNIT_INDEX_ROW)].map((row) => ({
      key: row[1],
      name: row[2]?.trim(),
      tier: row[3]?.trim(),
      seed: Number(row[4]),
    }));
    const expected = ART_MANIFEST.filter((spec) => spec.class === 'unit').map((spec) => {
      const unit = UNIT_CATALOG.find(
        (candidate) => spec.key === `unit-${candidate.id.replaceAll('_', '-')}`,
      );
      if (!unit) throw new Error(`no unit behind ${spec.key}`);
      return { key: spec.key, name: unit.name, tier: UNIT_TIER_LABELS[unit.tier], seed: spec.seed };
    });
    expect(documented).toEqual(expected);
  });

  it('documents a subject for every manifest asset and no others', () => {
    expect([...documentedSubjects.keys()].sort()).toEqual(
      ART_MANIFEST.map((spec) => spec.key).sort(),
    );
  });

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec.prompt.subject] as const))(
    '%s subject reads identically in both',
    (key, subject) => {
      expect(documentedSubjects.get(key)).toBe(subject);
    },
  );

  // The shared and per-class blocks ride on every prompt, so a drift here is a 44-asset drift.
  it.each([
    ['§0.1 style anchor', '### 0.1 ', STYLE_ANCHOR] as const,
    ['§0.2 negative', '### 0.2 ', NEGATIVE] as const,
    ...(Object.keys(FRAMING_SECTIONS) as (keyof typeof FRAMING)[]).map(
      (name) => [`${name} framing`, FRAMING_SECTIONS[name], FRAMING[name]] as const,
    ),
  ])('%s reads identically in both', (_, heading, block) => {
    expect(documentedBlock(heading)).toBe(block);
  });
});

describe('file naming grammar (ART-BIBLE §7)', () => {
  it.each(ART_MANIFEST.map((spec) => spec.file))('%s parses and is lower-kebab', (file) => {
    expect(parseAssetFileName(file)).not.toBeNull();
    expect(file).toBe(file.toLowerCase());
    expect(file).not.toMatch(/[\s_]/);
  });

  it.each([
    'District-Neon-Docks.webp',
    'district neon docks.webp',
    'district-neon-docks-v2.webp',
    'district-neon-docks-final.webp',
    'district_neon_docks.webp',
    'neon-docks.webp',
    'sprite-neon-docks.webp',
    'district-neon-docks.jpg',
  ])('rejects "%s"', (file) => {
    expect(parseAssetFileName(file)).toBeNull();
  });

  it('accepts variants and @2x', () => {
    expect(parseAssetFileName('building-reactor-damaged.webp')).toMatchObject({
      class: 'building',
      subject: 'reactor',
      variant: 'damaged',
      retina: false,
    });
    expect(parseAssetFileName('portrait-overseer-1@2x.webp')).toMatchObject({
      subject: 'overseer-1',
      retina: true,
    });
  });
});

describe('subject resolution (ART-BIBLE §7)', () => {
  it('resolves every portrait subject to an overseer portraitId', () => {
    for (const id of OVERSEER_PORTRAIT_IDS) {
      expect(subjectResolvesToDomainId('portrait', id), id).toBe(true);
    }
    // The four heroes are not in that list and still have to resolve: their art is delivered.
    for (const id of ['overseer-1', 'overseer-2', 'overseer-3', 'overseer-4']) {
      expect(subjectResolvesToDomainId('portrait', id), id).toBe(true);
    }
    // `overseer-9` is neither a hero nor a padded pool id, which is the point of the padding.
    expect(subjectResolvesToDomainId('portrait', 'overseer-9')).toBe(false);
    expect(subjectResolvesToDomainId('portrait', 'overseer-31')).toBe(false);
  });

  it('resolves every district subject to a District.id', () => {
    for (const district of CITY_DISTRICTS) {
      expect(subjectResolvesToDomainId('district', district.id)).toBe(true);
    }
    expect(subjectResolvesToDomainId('district', 'nowhere')).toBe(false);
  });

  it('resolves every building subject to a BuildingKind', () => {
    for (const kind of BUILDING_KINDS) {
      expect(subjectResolvesToDomainId('building', kind.replaceAll('_', '-'))).toBe(true);
    }
    expect(subjectResolvesToDomainId('building', 'sky-hook')).toBe(false);
  });

  it('resolves resource, archetype and district-kind icon subjects', () => {
    for (const resource of RESOURCE_KEYS) {
      const subject = resource.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase();
      expect(subjectResolvesToDomainId('icon', subject)).toBe(true);
    }
    // The camelCase key itself is not a legal subject: only its kebab form is.
    expect(subjectResolvesToDomainId('icon', 'highQualityMetal')).toBe(false);
    for (const archetype of OVERSEER_ARCHETYPES) {
      expect(subjectResolvesToDomainId('icon', `archetype-${archetype}`)).toBe(true);
    }
    for (const kind of DISTRICT_KINDS) {
      expect(subjectResolvesToDomainId('icon', `kind-${kind.replaceAll('_', '-')}`)).toBe(true);
    }
    expect(subjectResolvesToDomainId('icon', 'plutonium')).toBe(false);
    expect(subjectResolvesToDomainId('icon', 'archetype-samurai')).toBe(false);
    expect(subjectResolvesToDomainId('icon', 'kind-wasteland')).toBe(false);
  });

  it('does not constrain classes with no domain counterpart', () => {
    expect(subjectResolvesToDomainId('ui', 'frame-panel')).toBe(true);
    expect(subjectResolvesToDomainId('plane', 'city-sky')).toBe(true);
  });
});

describe('validateAssetSpec', () => {
  it('rejects a subject that resolves to no domain id', () => {
    const broken: AssetSpec = {
      ...districtSpec(),
      key: 'district-nowhere',
      file: 'district-nowhere.webp',
    };
    expect(validateAssetSpec(broken)).toContainEqual(
      expect.stringContaining('resolves to no district id'),
    );
  });

  it('rejects a resolution that contradicts the ART-BIBLE §6 table', () => {
    expect(validateAssetSpec({ ...districtSpec(), width: 800, height: 600 })).toContainEqual(
      expect.stringContaining('ART-BIBLE §6 requires 1024×1024'),
    );
  });

  it('rejects a filename that disagrees with the key', () => {
    expect(validateAssetSpec({ ...districtSpec(), file: 'district-rustyard.webp' })).toContainEqual(
      expect.stringContaining('does not match key'),
    );
  });

  it('rejects an unknown style reference', () => {
    expect(
      validateAssetSpec({ ...districtSpec(), styleRefs: ['district-atlantis'] }),
    ).toContainEqual(expect.stringContaining('unknown style ref'));
  });

  const withSource = (source: AssetSource, extra: Partial<AssetSpec> = {}): AssetSpec => ({
    ...districtSpec(),
    source,
    postProcess: postProcessFor(source, { width: 1024, height: 1024, alpha: false }, 'crop'),
    ...extra,
  });

  it('rejects a source smaller than the delivery: upscaling invents detail', () => {
    expect(validateAssetSpec(withSource({ width: 512, height: 512, alpha: false }))).toContainEqual(
      expect.stringContaining('smaller than its 1024×1024 delivery'),
    );
  });

  it('rejects a source that changes the aspect', () => {
    expect(
      validateAssetSpec(withSource({ width: 2048, height: 1152, alpha: false })),
    ).toContainEqual(expect.stringContaining('a different aspect'));
  });

  it('rejects a source carrying alpha the delivery throws away', () => {
    expect(
      validateAssetSpec(withSource({ width: 1024, height: 1024, alpha: true })),
    ).toContainEqual(expect.stringContaining('renders with alpha but ships opaque'));
  });

  it('rejects a declared post-process the source does not imply', () => {
    const spec = withSource(
      { width: 1024, height: 1024, alpha: false },
      { postProcess: ['matte'] },
    );
    expect(validateAssetSpec(spec)).toContainEqual(
      expect.stringContaining('declares postProcess [matte], its source implies []'),
    );
  });

  it('rejects an asset no backend can render: the MOU-123 failure mode', () => {
    // 512×512 with alpha: below gpt-image-1's minimum, and fal has no alpha channel.
    const spec = withSource({ width: 512, height: 512, alpha: true });
    expect(validateAssetSpec(spec)).toContainEqual(
      expect.stringContaining('has no producible backend path'),
    );
  });

  it('rejects a pin to a backend that cannot render the source', () => {
    const spec = withSource({ width: 1024, height: 1024, alpha: false }, { backend: 'openai' });
    expect(
      validateAssetSpec({ ...spec, source: { width: 2048, height: 1152, alpha: false } }),
    ).toContainEqual(expect.stringContaining('is pinned to "openai", which cannot render'));
  });
});

describe('backend capabilities (ADR 0001 §6.1)', () => {
  it('knows fal takes any size but no alpha', () => {
    expect(backendCanProduce('fal', { width: 2048, height: 1152, alpha: false })).toBe(true);
    expect(backendCanProduce('fal', { width: 512, height: 512, alpha: false })).toBe(true);
    expect(backendCanProduce('fal', { width: 1024, height: 1024, alpha: true })).toBe(false);
  });

  it('knows gpt-image-1 takes alpha but only three sizes', () => {
    expect(backendCanProduce('openai', { width: 1024, height: 1024, alpha: true })).toBe(true);
    expect(backendCanProduce('openai', { width: 1024, height: 1536, alpha: false })).toBe(true);
    expect(backendCanProduce('openai', { width: 2048, height: 1152, alpha: false })).toBe(false);
    expect(backendCanProduce('openai', { width: 512, height: 512, alpha: true })).toBe(false);
  });

  it('reports the empty set for a source neither backend can render', () => {
    expect(backendsForSource({ width: 512, height: 512, alpha: true })).toEqual([]);
    expect(backendsForSource({ width: 1024, height: 1024, alpha: false })).toEqual([
      'fal',
      'openai',
    ]);
  });
});

describe('postProcessFor', () => {
  it('derives the steps from the gap between source and delivery', () => {
    const delivery = { width: 512, height: 512, alpha: true };
    expect(postProcessFor({ width: 512, height: 512, alpha: true }, delivery, 'crop')).toEqual([]);
    expect(postProcessFor({ width: 1024, height: 1024, alpha: true }, delivery, 'crop')).toEqual([
      'downscale',
    ]);
    // Matte at master resolution, then downscale: the other order fringes the alpha edge.
    expect(postProcessFor({ width: 1024, height: 1024, alpha: false }, delivery, 'crop')).toEqual([
      'matte',
      'downscale',
    ]);
  });

  /**
   * `trim` is the one step that depends on the *fit* rather than on the source→delivery gap: a
   * cutout the scene positions is cropped to its own artwork, a picture that fills a fixed box is
   * not. It sits between the two, so it keys an image that has an alpha channel to measure and
   * hands the downscale the artwork rather than the artwork plus its margin.
   */
  it('crops a contained cutout to its own artwork, and only a contained one', () => {
    const opaqueMaster = { width: 1024, height: 1024, alpha: false };
    const cutout = { width: 512, height: 512, alpha: true };
    expect(postProcessFor(opaqueMaster, cutout, 'contain')).toEqual(['matte', 'trim', 'downscale']);
    expect(postProcessFor(opaqueMaster, cutout, 'crop')).toEqual(['matte', 'downscale']);
    // An opaque delivery has no alpha box to crop to, however it is fitted.
    expect(
      postProcessFor(opaqueMaster, { width: 512, height: 512, alpha: false }, 'contain'),
    ).toEqual(['downscale']);
  });
});

describe('resolveAssetKey', () => {
  it('builds keys for every domain id in the manifest', () => {
    expect(resolveAssetKey({ type: 'district', districtId: 'neon-docks' })).toBe(
      'district-neon-docks',
    );
    expect(resolveAssetKey({ type: 'building', building: 'scrapyard' })).toBe('building-scrapyard');
    expect(resolveAssetKey({ type: 'portrait', portraitId: 'overseer-2' })).toBe(
      'portrait-overseer-2',
    );
    expect(resolveAssetKey({ type: 'resource-icon', resource: 'highQualityMetal' })).toBe(
      'icon-high-quality-metal',
    );
    expect(resolveAssetKey({ type: 'archetype-icon', archetype: 'fixer' })).toBe(
      'icon-archetype-fixer',
    );
    expect(resolveAssetKey({ type: 'district-kind-icon', districtKind: 'contested' })).toBe(
      'icon-kind-contested',
    );
  });

  it('throws rather than returning a key with no manifest entry', () => {
    expect(() => resolveAssetKey({ type: 'district', districtId: 'nowhere' })).toThrow(
      /No manifest entry/,
    );
  });
});

describe('tryResolveAssetKey', () => {
  it('resolves a known id and answers undefined for an unknown one', () => {
    expect(tryResolveAssetKey({ type: 'portrait', portraitId: 'overseer-2' })).toBe(
      'portrait-overseer-2',
    );
    expect(tryResolveAssetKey({ type: 'portrait', portraitId: 'overseer-9' })).toBeUndefined();
  });
});
