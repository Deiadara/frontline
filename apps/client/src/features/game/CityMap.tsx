import type { BaseSummary, District, DistrictKind } from '@frontline/shared';
import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { palette } from '../../theme/tokens';

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

/**
 * The face every Text in the scene is drawn with. A `font` shorthand needs a size, but the
 * size does not select a different face — so this one spec covers the district labels, the
 * marker tags and the tooltip alike.
 */
const LABEL_FONT = '600 11px Orbitron';

/**
 * Resolves once the label font is actually usable.
 *
 * Pixi bakes a Text into a texture measured with whatever font is available when the object
 * is constructed, so a webfont arriving later strands the whole scene on the fallback:
 * labels in the wrong typeface, and glyphs clipped wherever the two metrics disagree. The
 * cure is to redraw once loading has settled — never to guess with a timeout.
 *
 * `fonts.load` is what forces the fetch: a CSS font is otherwise only requested for the DOM
 * that uses it, so `fonts.ready` alone can resolve before Orbitron is ever asked for.
 */
async function labelFontsReady(): Promise<void> {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (!fonts) return;
  // A font that fails to load must not block the redraw — the fallback is then correct.
  await fonts.load(LABEL_FONT).catch(() => undefined);
  await fonts.ready;
}

function radiusFor(district: District): number {
  return 7 + district.difficulty * 0.7;
}

/** Everything needed to redraw the scene, read fresh on each resize/prop change. */
interface Scene {
  app: Application;
  width: number;
  height: number;
  props: CityMapProps;
  /** Districts held by an AI rival — drawn hostile rather than in their kind color. */
  botDistrictIds: ReadonlySet<string>;
}

/** A district garrisoned by a bot reads as a threat, not as a friendly player base. */
function districtColor(district: District, botDistrictIds: ReadonlySet<string>): number {
  return botDistrictIds.has(district.id) ? hex(palette.neon.magenta) : KIND_COLOR[district.kind];
}

function drawBackground(width: number, height: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, width, height).fill({ color: hex(palette.night.raised), alpha: 0.35 });
  const step = 48;
  for (let x = step; x < width; x += step) g.moveTo(x, 0).lineTo(x, height);
  for (let y = step; y < height; y += step) g.moveTo(0, y).lineTo(width, y);
  g.stroke({ width: 1, color: hex(palette.steel[700]), alpha: 0.25 });
  return g;
}

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

/** Gap between the marker glyph and the tag sitting above it. */
const TAG_GAP = 8;
/** How far above the district node the marker floats — clears the node's halo. */
const MARKER_LIFT = 17;
/** Keeps a marker's tag from being clipped by the top edge of the canvas. */
const MARKER_MIN_Y = 26;
/** Keeps a tag from bleeding past the left/right edges of the canvas. */
const EDGE_PADDING = 4;
/** Vertical pitch between markers sharing a district — clears a marker's glyph and tag. */
const MARKER_STACK_STEP = 28;

/** A marker's slot among the bases sharing its district. */
interface MarkerSlot {
  /** 0 sits nearest the district node; each further marker floats one step higher. */
  index: number;
  count: number;
}

/**
 * Districts are not exclusive — every human settles in the same starter district — so
 * co-located markers stack straight up from their node instead of drawing on top of each
 * other. The stack is clamped into the canvas as a unit, which keeps the pitch exact and
 * leaves a district's only marker exactly where it has always been.
 */
export function markerY(nodeY: number, nodeRadius: number, slot: MarkerSlot): number {
  const bottom = nodeY - nodeRadius - MARKER_LIFT;
  const top = bottom - (slot.count - 1) * MARKER_STACK_STEP;
  const lift = Math.max(0, MARKER_MIN_Y - top);
  return bottom - slot.index * MARKER_STACK_STEP + lift;
}

/** Bases grouped by district and ordered by id, so the stack order is stable across renders. */
export function groupByDistrict(bases: readonly BaseSummary[]): Map<string, BaseSummary[]> {
  const groups = new Map<string, BaseSummary[]>();
  for (const base of [...bases].sort((a, b) => a.id.localeCompare(b.id))) {
    const group = groups.get(base.districtId);
    if (group) group.push(base);
    else groups.set(base.districtId, [base]);
  }
  return groups;
}

/**
 * Base markers sit above their district node so they never cover the district label
 * (which is drawn below the node). Own base = cyan diamond tagged YOU, bot base =
 * magenta hostile chevron tagged with the rival's name, other humans = muted diamond.
 */
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
    // Downward chevron — hostile, and unmistakably not the friendly diamond.
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

  // Clamp into the canvas: the tag is the widest/highest part of the marker.
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

function redraw(input: Omit<Scene, 'botDistrictIds'>): void {
  const { app, width, height } = input;
  if (width < 2 || height < 2) return;
  const scene: Scene = {
    ...input,
    botDistrictIds: new Set(
      input.props.bases.filter((base) => base.isBot).map((base) => base.districtId),
    ),
  };
  for (const child of app.stage.removeChildren()) child.destroy({ children: true });
  app.stage.sortableChildren = true;

  const tooltip = makeTooltip();
  app.stage.addChild(drawBackground(width, height));
  for (const district of scene.props.districts) {
    app.stage.addChild(drawDistrictNode(scene, district, tooltip));
  }
  for (const group of groupByDistrict(scene.props.bases).values()) {
    group.forEach((base, index) => {
      const marker = drawBaseMarker(scene, base, { index, count: group.length });
      if (marker) app.stage.addChild(marker);
    });
  }
  app.stage.addChild(tooltip);
}

/**
 * Pixi city map. The renderer is sized to its container via ResizeObserver, the
 * container clips overflow, and the app is destroyed on unmount.
 */
export function CityMap(props: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Mount once: create the Pixi app + observe container size.
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
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        el.appendChild(app.canvas);
        const render = () => {
          const { width, height } = el.getBoundingClientRect();
          app.renderer.resize(width, height);
          redraw({ app, width, height, props: propsRef.current });
        };
        observer = new ResizeObserver(render);
        observer.observe(el);
        render();

        // Paint immediately so the map is never blank, then redraw once the label font has
        // landed so nothing keeps a texture measured against the fallback.
        void labelFontsReady().then(() => {
          if (!disposed) render();
        });
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  // Redraw when data / selection changes (size changes are handled by the observer).
  useEffect(() => {
    const app = appRef.current;
    const el = containerRef.current;
    if (!app || !el) return;
    const { width, height } = el.getBoundingClientRect();
    redraw({ app, width, height, props });
  }, [props]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
