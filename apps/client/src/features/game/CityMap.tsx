import type { BaseSummary, District, DistrictKind } from '@frontline/shared';
import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { artLoader } from '../../assets/loader';
import { paintProcedural } from '../../render/procedural';
import { PARALLAX_PLANES, planeOffset, type PlaneId, type Vec2 } from '../../render/layers';
import { createPostFx, createVignette, type PostFxChain } from '../../render/grade';
import { createViewport, resizeViewport } from '../../render/viewport';
import { palette } from '../../theme/tokens';
import type { Viewport } from 'pixi-viewport';

interface CityMapProps {
  districts: readonly District[];
  bases: readonly BaseSummary[];
  myBaseId: string | null;
  selectedId: string | null;
  onSelectDistrict: (district: District) => void;
}

const hex = (value: string): number => Number.parseInt(value.replace('#', ''), 16);

const KIND_COLOR: Record<DistrictKind, number> = {
  player_base: hex(palette.neon.cyan),
  npc_stronghold: hex(palette.neon.magenta),
  raid: hex(palette.warning),
  market: hex(palette.steel[300]),
};

const LABEL_STYLE: TextStyleOptions = {
  fontFamily: 'Orbitron, sans-serif',
  fontSize: 11,
  fontWeight: '600',
  fill: hex(palette.steel[200]),
  letterSpacing: 0.5,
};

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

/** A district garrisoned by a bot reads as a threat, not as a friendly player base. */
function districtColor(district: District, botDistrictIds: ReadonlySet<string>): number {
  return botDistrictIds.has(district.id) ? hex(palette.neon.magenta) : KIND_COLOR[district.kind];
}

interface Scene {
  app: Application;
  viewport: Viewport;
  planes: Map<PlaneId, Container>;
  postFx: PostFxChain;
  width: number;
  height: number;
  props: CityMapProps;
  /** Districts held by an AI rival — drawn hostile rather than in their kind colour. */
  botDistrictIds: ReadonlySet<string>;
}

// ─── tooltip ────────────────────────────────────────────────────────────────

function makeTooltip(): Container {
  const container = new Container();
  container.visible = false;
  container.zIndex = 100;
  const bg = new Graphics();
  const text = new Text({
    text: '',
    style: { ...LABEL_STYLE, fontSize: 10, fill: hex(palette.steel[100]) },
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

function drawDistrictNode(scene: Scene, district: District, tooltip: Container): Container {
  const { width, height, props } = scene;
  const px = district.position.x * width;
  const py = district.position.y * height;
  const r = radiusFor(district);
  const color = districtColor(district, scene.botDistrictIds);
  const isSelected = props.selectedId === district.id;

  const node = new Container();
  node.position.set(px, py);
  node.eventMode = 'static';
  node.cursor = 'pointer';
  node.hitArea = { contains: (hx: number, hy: number) => hx * hx + hy * hy <= (r + 8) * (r + 8) };

  const halo = new Graphics();
  halo.circle(0, 0, r + 6).fill({ color, alpha: isSelected ? 0.28 : 0.12 });

  const dot = new Graphics();
  dot
    .circle(0, 0, r)
    .fill({ color, alpha: 0.85 })
    .stroke({ width: isSelected ? 2.5 : 1.5, color: isSelected ? hex(palette.steel[100]) : color });

  const label = new Text({ text: district.name, style: LABEL_STYLE });
  label.anchor.set(0.5, 0);
  label.position.set(0, r + 4);

  node.addChild(halo, dot, label);

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
    style: { ...LABEL_STYLE, fontSize: 8, fill: color },
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
 * Rebuilds procedural background planes. Called on mount and resize — not on every prop change,
 * since geometry is seeded from dimensions, not data.
 */
function buildProceduralPlanes(scene: Scene): void {
  for (const planeSpec of PARALLAX_PLANES) {
    if (!planeSpec.assetKey) continue;
    const container = scene.planes.get(planeSpec.id);
    if (!container) continue;
    for (const child of container.removeChildren()) child.destroy({ children: true });
    const source = artLoader.sourceOf(planeSpec.assetKey);
    const painted = paintProcedural(source, scene.width, scene.height);
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
    botDistrictIds: new Set(scene.props.bases.filter((b) => b.isBot).map((b) => b.districtId)),
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const app = new Application();
    let observer: ResizeObserver | undefined;
    let disposed = false;

    void app
      .init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      })
      .then(async () => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }

        el.appendChild(app.canvas);

        const { width, height } = el.getBoundingClientRect();

        // Start fetching the city bundle — procedural keys resolve synchronously.
        artLoader.ensure('city');

        // Build the parallax plane containers (draw order = PARALLAX_PLANES order).
        const planes = new Map<PlaneId, Container>();
        for (const planeSpec of PARALLAX_PLANES) {
          const container = new Container();
          container.label = planeSpec.id;
          container.sortableChildren = planeSpec.id === 'nodes';
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

        const vignette = createVignette(width, height);
        app.stage.addChild(viewport);
        if (gradePlane) {
          app.stage.addChild(gradePlane);
        }
        app.stage.addChild(vignette);

        // Enable interactive events through the viewport.
        app.stage.eventMode = 'static';
        viewport.eventMode = 'static';
        const nodesLayer = planes.get('nodes');
        if (nodesLayer) nodesLayer.eventMode = 'static';

        const scene: Scene = {
          app,
          viewport,
          planes,
          postFx,
          width,
          height,
          props: propsRef.current,
          botDistrictIds: new Set(),
        };
        sceneRef.current = scene;

        buildProceduralPlanes(scene);
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
          const w = rect.width;
          const h = rect.height;
          if (w < 2 || h < 2) return;
          app.renderer.resize(w, h);
          resizeViewport(viewport, w, h);

          // Rebuild vignette to fit new dimensions.
          vignette.destroy();
          const newVig = createVignette(w, h);
          app.stage.addChild(newVig);

          scene.width = w;
          scene.height = h;
          buildProceduralPlanes(scene);
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
      app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    buildNodes({ ...scene, props });
  }, [props]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
