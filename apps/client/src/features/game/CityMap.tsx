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

function radiusFor(district: District): number {
  return 7 + district.difficulty * 0.7;
}

/** Everything needed to redraw the scene, read fresh on each resize/prop change. */
interface Scene {
  app: Application;
  width: number;
  height: number;
  props: CityMapProps;
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

function updateTooltip(tooltip: Container, district: District, x: number, y: number): void {
  const bg = tooltip.children[0] as Graphics;
  const text = tooltip.children[1] as Text;
  text.text = `${district.name}  ·  DIFF ${district.difficulty}`;
  const w = text.width + 16;
  const h = text.height + 10;
  bg.clear()
    .rect(0, 0, w, h)
    .fill({ color: hex(palette.night.overlay), alpha: 0.95 })
    .stroke({ width: 1, color: KIND_COLOR[district.kind], alpha: 0.8 });
  tooltip.position.set(Math.max(2, x - w / 2), Math.max(2, y - h - 12));
  tooltip.visible = true;
}

function drawDistrictNode(scene: Scene, district: District, tooltip: Container): Container {
  const { width, height, props } = scene;
  const px = district.position.x * width;
  const py = district.position.y * height;
  const r = radiusFor(district);
  const color = KIND_COLOR[district.kind];
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
    updateTooltip(tooltip, district, px, py - r);
  });
  node.on('pointerout', () => {
    halo.scale.set(1);
    tooltip.visible = false;
  });

  return node;
}

function drawBaseMarker(scene: Scene, base: BaseSummary): Container | null {
  const { width, height, props } = scene;
  const district = props.districts.find((d) => d.id === base.districtId);
  if (!district) return null;
  const px = district.position.x * width;
  const py = district.position.y * height;
  const isMine = base.id === props.myBaseId;
  const color = isMine ? hex(palette.neon.cyan) : hex(palette.steel[300]);

  const marker = new Container();
  marker.position.set(px, py - radiusFor(district) - 12);

  const diamond = new Graphics();
  diamond
    .poly([0, -6, 5, 0, 0, 6, -5, 0])
    .fill({ color, alpha: isMine ? 1 : 0.7 })
    .stroke({ width: 1, color: hex(palette.night.DEFAULT) });

  const tag = new Text({
    text: isMine ? 'YOU' : base.name,
    style: { ...LABEL_STYLE, fontSize: 8, fill: color },
  });
  tag.anchor.set(0.5, 1);
  tag.position.set(0, -8);

  marker.addChild(diamond, tag);
  return marker;
}

function redraw(scene: Scene): void {
  const { app, width, height } = scene;
  if (width < 2 || height < 2) return;
  for (const child of app.stage.removeChildren()) child.destroy({ children: true });
  app.stage.sortableChildren = true;

  const tooltip = makeTooltip();
  app.stage.addChild(drawBackground(width, height));
  for (const district of scene.props.districts) {
    app.stage.addChild(drawDistrictNode(scene, district, tooltip));
  }
  for (const base of scene.props.bases) {
    const marker = drawBaseMarker(scene, base);
    if (marker) app.stage.addChild(marker);
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
