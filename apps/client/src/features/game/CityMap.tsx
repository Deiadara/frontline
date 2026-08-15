import type { AssetKey, BaseSummary, District, DistrictSummary } from '@frontline/shared';
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
  type TextStyleOptions,
} from 'pixi.js';
import { useEffect, useRef } from 'react';
import { deliveredTexture } from '../../assets/delivered';
import { artLoader, type ArtLoader } from '../../assets/loader';
import { useAssetBundle } from '../../assets/useAssetBundle';
import { paintPlaneFallback, paintProcedural } from '../../render/procedural';
import { PARALLAX_PLANES, planeOffset, type PlaneId, type Vec2 } from '../../render/layers';
import { createPostFx, createVignette, type PostFxChain } from '../../render/grade';
import { createViewport, resizeViewport } from '../../render/viewport';
import { palette, ramps } from '../../theme/tokens';
import type { Viewport } from 'pixi-viewport';

interface CityMapProps {
  districts: readonly District[];
  bases: readonly BaseSummary[];
  /**
   * §A4 — what this crew knows about each district, keyed by id.
   *
   * Passed alongside the districts rather than replacing them because the scene's geometry is a
   * pure function of the *map* and only its colouring is a function of what has been seen. Keeping
   * the two apart means the fog cannot accidentally move a marker.
   */
  intel: ReadonlyMap<string, DistrictSummary>;
  myBaseId: string | null;
  selectedId: string | null;
  onSelectDistrict: (district: District) => void;
}

const hex = (value: string): number => Number.parseInt(value.replace('#', ''), 16);

/**
 * What a district's marker says at a glance (§A4).
 *
 * Ownership first, then allegiance — the question a player is asking when they look at the map is
 * "whose is that", and only after that "what is it". Unscouted ground is smog: legible as a place
 * that exists, illegible as anything else, which is exactly what fog should feel like.
 */
const FOG_COLOR = hex(ramps.smog[500]);
const MINE_COLOR = hex(palette.neon.cyan);
const HOSTILE_COLOR = hex(palette.neon.magenta);
const NEUTRAL_COLOR = hex(palette.warning);

/**
 * The city behind a label is a dense field of lit windows at every value, so a plain fill is
 * unreadable wherever it happens to land on one. The dark casing gives every label the same
 * contrast regardless of what it sits over.
 *
 * The casing is a ratio of the type size, not a constant: 3px around an 11px district name reads
 * as a clean outline, but the same 3px around an 8px base tag closes up the counters and turns
 * the word into a smudge.
 */
function labelStyle(fontSize: number, fill: number): TextStyleOptions {
  return {
    fontFamily: 'Orbitron, sans-serif',
    fontSize,
    fontWeight: '600',
    fill,
    letterSpacing: 0.5,
    stroke: { color: hex(ramps.abyss[950]), width: fontSize * 0.28, join: 'round' },
    dropShadow: {
      color: hex(ramps.abyss[950]),
      alpha: 0.9,
      blur: 4,
      distance: 1,
      angle: Math.PI / 2,
    },
  };
}

const LABEL_STYLE = labelStyle(11, hex(palette.steel[200]));

const LABEL_FONT = '600 11px Orbitron';

async function labelFontsReady(): Promise<void> {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (!fonts) return;
  await fonts.load(LABEL_FONT).catch(() => undefined);
  await fonts.ready;
}

function radiusFor(district: District): number {
  return 7 + district.difficulty * 0.7;
}

function districtColor(
  district: District,
  intel: ReadonlyMap<string, DistrictSummary>,
  myBaseId: string | null,
): number {
  const entry = intel.get(district.id);
  if (!entry || !entry.scouted) return FOG_COLOR;
  if (entry.isHome) return MINE_COLOR;

  if (entry.holder?.kind === 'faction') {
    return entry.holder.baseId === myBaseId ? MINE_COLOR : HOSTILE_COLOR;
  }
  // Somebody else's home, or the state's ground.
  if (entry.base || district.faction === 'government') return HOSTILE_COLOR;
  // Contested ground this crew has a foothold in still reads as partly theirs.
  return (entry.held?.mine ?? 0) > 0 ? MINE_COLOR : NEUTRAL_COLOR;
}

interface Scene {
  app: Application;
  viewport: Viewport;
  planes: Map<PlaneId, Container>;
  postFx: PostFxChain;
  width: number;
  height: number;
  props: CityMapProps;
}

// ─── tooltip ────────────────────────────────────────────────────────────────

function makeTooltip(): Container {
  const container = new Container();
  container.visible = false;
  container.zIndex = 100;
  const bg = new Graphics();
  const text = new Text({
    text: '',
    style: labelStyle(10, hex(palette.steel[100])),
  });
  text.position.set(8, 5);
  container.addChild(bg, text);
  container.label = 'tooltip';
  return container;
}

function updateTooltip(
  tooltip: Container,
  district: District,
  x: number,
  y: number,
  color: number,
): void {
  const bg = tooltip.children[0] as Graphics;
  const text = tooltip.children[1] as Text;
  text.text = `${district.name}  ·  DIFF ${district.difficulty}`;
  const w = text.width + 16;
  const h = text.height + 10;
  bg.clear()
    .rect(0, 0, w, h)
    .fill({ color: hex(palette.night.overlay), alpha: 0.95 })
    .stroke({ width: 1, color, alpha: 0.8 });
  tooltip.position.set(Math.max(2, x - w / 2), Math.max(2, y - h - 12));
  tooltip.visible = true;
}

// ─── district nodes ──────────────────────────────────────────────────────────

/** A node with no art behind it: the colour is the entire face. */
const FACE_ALPHA = 0.85;
/**
 * Over a delivered illustration the same colour stays on as a scrim rather than dropping to the
 * ring. `districtColor` is a threat code, not decoration — a bot-garrisoned district is magenta —
 * and a node is only 8–14px across, so a hairline ring does not carry it. The ring cannot carry it
 * at all on the selected node, where the stroke turns steel.
 *
 * A scrim and not `art.tint`: tint multiplies, so dark art times magenta and dark art times cyan
 * are both near-black. Compositing over the art keeps the codes apart whatever the art's luminance.
 */
const ART_SCRIM_ALPHA = 0.45;

/**
 * The node's face. A delivered district illustration is masked into the circle; until then it is
 * the flat kind colour it has always been. The kind/threat colour and the ring are drawn the same
 * way either way, so the node keeps its selection state, its silhouette and its colour code on the
 * map whichever way it resolves.
 */
export function districtFace(
  district: District,
  r: number,
  color: number,
  isSelected: boolean,
): Container {
  const ring = new Graphics().circle(0, 0, r);
  const texture = deliveredTexture({ type: 'district', districtId: district.id });
  ring.fill({ color, alpha: texture ? ART_SCRIM_ALPHA : FACE_ALPHA });
  ring.stroke({
    width: isSelected ? 2.5 : 1.5,
    color: isSelected ? hex(palette.steel[100]) : color,
  });
  if (!texture) return ring;

  const art = new Sprite(texture);
  art.anchor.set(0.5);
  art.width = r * 2;
  art.height = r * 2;
  const mask = new Graphics().circle(0, 0, r).fill(0xffffff);
  art.mask = mask;

  const face = new Container();
  face.addChild(art, mask, ring);
  return face;
}

function drawDistrictNode(scene: Scene, district: District, tooltip: Container): Container {
  const { width, height, props } = scene;
  const px = district.position.x * width;
  const py = district.position.y * height;
  const r = radiusFor(district);
  const color = districtColor(district, scene.props.intel, scene.props.myBaseId);
  const isSelected = props.selectedId === district.id;

  const node = new Container();
  node.position.set(px, py);
  node.eventMode = 'static';
  node.cursor = 'pointer';
  node.hitArea = { contains: (hx: number, hy: number) => hx * hx + hy * hy <= (r + 8) * (r + 8) };

  const halo = new Graphics();
  halo.circle(0, 0, r + 6).fill({ color, alpha: isSelected ? 0.28 : 0.12 });

  const label = new Text({ text: district.name, style: LABEL_STYLE });
  label.anchor.set(0.5, 0);
  label.position.set(0, r + 4);

  node.addChild(halo, districtFace(district, r, color, isSelected), label);

  node.on('pointertap', () => props.onSelectDistrict(district));
  node.on('pointerover', () => {
    halo.scale.set(1.25);
    updateTooltip(tooltip, district, px, py - r, color);
  });
  node.on('pointerout', () => {
    halo.scale.set(1);
    tooltip.visible = false;
  });

  return node;
}

// ─── base markers ────────────────────────────────────────────────────────────

const TAG_GAP = 8;
const MARKER_LIFT = 17;
const MARKER_MIN_Y = 26;
const EDGE_PADDING = 4;
const MARKER_STACK_STEP = 28;

interface MarkerSlot {
  index: number;
  count: number;
}

export function markerY(nodeY: number, nodeRadius: number, slot: MarkerSlot): number {
  const bottom = nodeY - nodeRadius - MARKER_LIFT;
  const top = bottom - (slot.count - 1) * MARKER_STACK_STEP;
  const lift = Math.max(0, MARKER_MIN_Y - top);
  return bottom - slot.index * MARKER_STACK_STEP + lift;
}

export function groupByDistrict(bases: readonly BaseSummary[]): Map<string, BaseSummary[]> {
  const groups = new Map<string, BaseSummary[]>();
  for (const base of [...bases].sort((a, b) => a.id.localeCompare(b.id))) {
    const group = groups.get(base.districtId);
    if (group) group.push(base);
    else groups.set(base.districtId, [base]);
  }
  return groups;
}

function drawBaseMarker(scene: Scene, base: BaseSummary, slot: MarkerSlot): Container | null {
  const { width, height, props } = scene;
  const district = props.districts.find((d) => d.id === base.districtId);
  if (!district) return null;
  const isMine = base.id === props.myBaseId;
  const color = base.isBot
    ? hex(palette.neon.magenta)
    : isMine
      ? hex(palette.neon.cyan)
      : hex(palette.steel[300]);

  const glyph = new Graphics();
  if (base.isBot) {
    glyph
      .poly([0, 7, -7, -5, 0, -1, 7, -5])
      .fill({ color, alpha: 1 })
      .stroke({ width: 1, color: hex(palette.night.DEFAULT) });
  } else {
    glyph
      .poly([0, -6, 5, 0, 0, 6, -5, 0])
      .fill({ color, alpha: isMine ? 1 : 0.7 })
      .stroke({ width: 1, color: hex(palette.night.DEFAULT) });
  }

  const tag = new Text({
    text: isMine ? 'YOU' : base.name,
    style: labelStyle(9, color),
  });
  tag.anchor.set(0.5, 1);
  tag.position.set(0, -TAG_GAP);

  const halfTag = tag.width / 2;
  const px = district.position.x * width;
  const py = district.position.y * height;
  const marker = new Container();
  marker.position.set(
    Math.min(Math.max(px, halfTag + EDGE_PADDING), width - halfTag - EDGE_PADDING),
    markerY(py, radiusFor(district), slot),
  );

  marker.addChild(glyph, tag);
  return marker;
}

// ─── scene builders ──────────────────────────────────────────────────────────

/**
 * How a delivered plane master is fitted to the frame: **cover** — scaled uniformly by whichever
 * axis needs the most, then centred, so the surplus is cropped off the other axis.
 *
 * A plane is painted at the live `scene.width × scene.height`, which no fixed-size master will
 * match at every viewport. `contain` would letterbox, and the bars would be transparent — the empty
 * stage showing straight through the background. `stretch` would squash a skyline into something
 * that reads as a rendering fault at any aspect but the master's own. Cover is the only rule that
 * is both full-bleed and undistorted; the price is that a master must keep its load-bearing
 * composition off the edges, since the long axis is trimmed.
 */
function coverSprite(texture: Texture, width: number, height: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(Math.max(width / texture.width, height / texture.height));
  sprite.position.set(width / 2, height / 2);
  return sprite;
}

/**
 * One plane's art at the frame's size: the delivered master once its texture is in hand, and the
 * procedural painting until then — including for a key that resolves to a file, because a delivered
 * plane is fetched over the network and must not leave the background blank while it travels.
 */
function paintPlane(
  key: AssetKey,
  width: number,
  height: number,
  loader: ArtLoader = artLoader,
): Container | null {
  const source = loader.sourceOf(key);
  if (source?.kind !== 'file') return paintProcedural(source, width, height);
  const texture = loader.textureOf(key);
  return texture ? coverSprite(texture, width, height) : paintPlaneFallback(key, width, height);
}

/** The slice of {@link Scene} the background planes are painted from. */
interface PlaneScene {
  planes: Map<PlaneId, Container>;
  width: number;
  height: number;
}

/**
 * Rebuilds the background planes. Called on mount, on resize, and when the city bundle settles —
 * not on every prop change, since plane geometry is seeded from dimensions, not data.
 */
export function buildPlanes(scene: PlaneScene, loader: ArtLoader = artLoader): void {
  for (const planeSpec of PARALLAX_PLANES) {
    if (!planeSpec.assetKey) continue;
    const container = scene.planes.get(planeSpec.id);
    if (!container) continue;
    for (const child of container.removeChildren()) child.destroy({ children: true });
    const painted = paintPlane(planeSpec.assetKey, scene.width, scene.height, loader);
    if (painted) container.addChild(painted);
  }
}

/**
 * Rebuilds only the interactive nodes plane (district nodes + base markers). Called on every
 * prop change so selection/data changes are reflected immediately.
 */
function buildNodes(scene: Scene): void {
  if (scene.width < 2 || scene.height < 2) return;
  const nodesContainer = scene.planes.get('nodes');
  if (!nodesContainer) return;
  for (const child of nodesContainer.removeChildren()) child.destroy({ children: true });

  const enriched: Scene = {
    ...scene,
  };

  const tooltip = makeTooltip();
  for (const district of scene.props.districts) {
    nodesContainer.addChild(drawDistrictNode(enriched, district, tooltip));
  }
  for (const group of groupByDistrict(scene.props.bases).values()) {
    group.forEach((base, index) => {
      const marker = drawBaseMarker(enriched, base, { index, count: group.length });
      if (marker) nodesContainer.addChild(marker);
    });
  }
  nodesContainer.addChild(tooltip);
}

/**
 * Updates each parallax plane's position to compensate for the viewport's scroll, giving each
 * band its own apparent speed. Screen-pinned planes (atmosphere, grade) end up back at (0,0)
 * in screen space. Called from the viewport's `moved` event.
 */
function applyParallax(planes: Map<PlaneId, Container>, camera: Vec2): void {
  for (const planeSpec of PARALLAX_PLANES) {
    const container = planes.get(planeSpec.id);
    if (!container) continue;
    const offset = planeOffset(planeSpec, camera);
    container.position.set(offset.x, offset.y);
  }
}

// ─── React component ─────────────────────────────────────────────────────────

export function CityMap(props: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // District art arrives after the first paint, so the nodes are rebuilt when the bundle lands.
  const cityArt = useAssetBundle('city');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const app = new Application();
    let observer: ResizeObserver | undefined;
    let disposed = false;
    /**
     * `Application.destroy()` tears down plugins that only exist after `init()` resolves, so
     * destroying a not-yet-initialised app throws. Under StrictMode the effect is torn down
     * before `init()` settles, and that throw used to unmount the whole game screen — hence
     * the flag: only the side that owns a live app destroys it.
     */
    let initialized = false;

    void app
      .init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      })
      .then(async () => {
        initialized = true;
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }

        el.appendChild(app.canvas);

        // Pixi boots at its 800×600 default; without this the canvas leaves a dead band in the
        // frame and every district — positioned as a fraction of the frame — lands off-canvas.
        const rect = el.getBoundingClientRect();
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        app.renderer.resize(width, height);

        // Start fetching the city bundle — procedural keys resolve synchronously.
        artLoader.ensure('city');

        // Build the parallax plane containers (draw order = PARALLAX_PLANES order).
        const planes = new Map<PlaneId, Container>();
        for (const planeSpec of PARALLAX_PLANES) {
          const container = new Container();
          container.label = planeSpec.id;
          container.sortableChildren = planeSpec.interactive;
          // Exactly one plane takes pointer events (ADR §5.2). The painted planes are stacked over
          // the interactive one, so leaving them hit-testable would let scenery eat the clicks.
          container.eventMode = planeSpec.interactive ? 'static' : 'none';
          planes.set(planeSpec.id, container);
        }

        const viewport = createViewport(app, {
          screenWidth: width,
          screenHeight: height,
          worldWidth: width,
          worldHeight: height,
        });

        // All planes live inside the viewport; the viewport pans them together.
        for (const id of ['sky', 'far', 'mid', 'nodes', 'fore', 'atmosphere'] as PlaneId[]) {
          const c = planes.get(id);
          if (c) viewport.addChild(c);
        }

        // Grade plane sits on top of the viewport in screen space.
        const gradePlane = planes.get('grade');

        const postFx = createPostFx({ tier: 'high' });
        // Apply the filter chain to the viewport so it covers the whole scrollable scene.
        viewport.filters = [...postFx.filters];

        let vignette = createVignette(width, height);
        app.stage.addChild(viewport);
        if (gradePlane) {
          app.stage.addChild(gradePlane);
        }
        app.stage.addChild(vignette);

        // Enable interactive events through the viewport.
        app.stage.eventMode = 'static';
        viewport.eventMode = 'static';

        const scene: Scene = {
          app,
          viewport,
          planes,
          postFx,
          width,
          height,
          props: propsRef.current,
        };
        sceneRef.current = scene;

        buildPlanes(scene);
        buildNodes({ ...scene, props: propsRef.current });

        // Parallax: update plane positions whenever the user pans.
        viewport.on('moved', () => {
          const camera = { x: viewport.left, y: viewport.top };
          applyParallax(planes, camera);
        });

        // Grain boil at 12 Hz — advance uses absolute time since creation.
        const startTime = performance.now();
        app.ticker.add(() => {
          postFx.advance(performance.now() - startTime);
        });

        observer = new ResizeObserver(() => {
          if (disposed) return;
          const rect = el.getBoundingClientRect();
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          if (w < 2 || h < 2) return;
          // ResizeObserver fires once on `observe()` with the size we already built for.
          if (w === scene.width && h === scene.height) return;
          app.renderer.resize(w, h);
          resizeViewport(viewport, w, h);

          // The vignette is sized in world units, so it is rebuilt rather than scaled. Swap the
          // reference too — otherwise the next resize destroys a dead object and leaves this one
          // stacked on the scene, darkening the map one multiply-blend at a time.
          vignette.destroy();
          vignette = createVignette(w, h);
          app.stage.addChild(vignette);

          scene.width = w;
          scene.height = h;
          buildPlanes(scene);
          buildNodes({ ...scene, props: propsRef.current });
        });
        observer.observe(el);

        await labelFontsReady();
        if (!disposed) {
          buildNodes({ ...scene, props: propsRef.current });
        }
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      sceneRef.current?.postFx.destroy();
      sceneRef.current = null;
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    buildNodes({ ...scene, props });
  }, [props, cityArt.status]);

  // A delivered plane master is fetched over the network, so it is not in hand when the scene is
  // first built. Repainting when the bundle settles swaps the interim skyline for the master; a
  // bundle with nothing delivered is `ready` on its first snapshot and never re-enters here.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    buildPlanes(scene);
  }, [cityArt.status]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
