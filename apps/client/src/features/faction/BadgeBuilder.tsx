import {
  BADGE_COLORS,
  BADGE_COLOR_VALUES,
  BADGE_FIELDS,
  BADGE_FIELD_LABELS,
  BADGE_PROPS,
  BADGE_PROP_LABELS,
  BADGE_SHAPES,
  BADGE_SHAPE_LABELS,
  badgeIsLegible,
  randomBadge,
  type BadgeColor,
  type FactionBadge as Badge,
} from '@frontline/shared';
import { cn } from '../../lib/cn';
import { Icon } from '../../components/ui/Icon';
import { FactionBadge, PropGlyph } from './FactionBadge';

/**
 * The badge builder.
 *
 * The shape every game with a crest editor uses, because it is the one that works: the drawing is
 * large and permanent on one side, the decisions are rows of swatches on the other, and every
 * swatch is itself drawn rather than named. Nothing here is a dropdown. A player choosing between
 * `lozenge` and `wedge` from a list is reading two words they have no reason to know; choosing
 * between two pictures of them is not a decision that needs vocabulary.
 *
 * ## Why the previews are real badges
 *
 * Each shape swatch renders the player's *current* badge in that shape, and each colour swatch
 * their current badge in that colour. It costs one more render and it removes the entire class of
 * "I picked it and it was not what the little icon suggested": the preview is the thing.
 */

export function BadgeBuilder({
  badge,
  onChange,
  className,
}: {
  badge: Badge;
  onChange: (badge: Badge) => void;
  className?: string;
}) {
  const set = <K extends keyof Badge>(key: K, value: Badge[K]) =>
    onChange({ ...badge, [key]: value });
  const legible = badgeIsLegible(badge);

  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:gap-5', className)}>
      {/* The badge, big. The reason the panel is this wide. */}
      <div className="flex shrink-0 flex-col items-center gap-2.5">
        <div className="ink-frame flex items-center justify-center px-4 py-3">
          <FactionBadge badge={badge} size={96} title="Your faction's badge" />
        </div>
        <button
          type="button"
          onClick={() => onChange(randomBadge(Math.floor(Math.random() * 1e9) + 1))}
          data-testid="badge-roll"
          className="ink-box inline-flex items-center gap-1.5 px-3 py-1.5 font-stamp text-[13px] leading-none text-brass-200 transition-colors hover:text-brass-100"
        >
          <Icon name="spark" aria-hidden className="h-3.5 w-3.5" />
          Roll one
        </button>
      </div>

      {/*
        Each choice beside the colour it takes, two to a line where there is room.
        Stacked, the six rows are 450px tall and the creation sheet does not fit a 720p screen with
        its own Create button on it. Pairing them is also how they read: a shape and its ground are
        one decision made twice.
      */}
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Row label="Shape">
          {BADGE_SHAPES.map((shape) => (
            <Swatch
              key={shape}
              selected={badge.shape === shape}
              onClick={() => set('shape', shape)}
              label={BADGE_SHAPE_LABELS[shape]}
              testId={`badge-shape-${shape}`}
            >
              <FactionBadge badge={{ ...badge, shape }} size={26} />
            </Swatch>
          ))}
        </Row>

        <Row label="Ground">
          {BADGE_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              color={color}
              selected={badge.ground === color}
              onClick={() => set('ground', color)}
              testId={`badge-ground-${color}`}
            />
          ))}
        </Row>

        <Row label="Pattern">
          {BADGE_FIELDS.map((field) => (
            <Swatch
              key={field}
              selected={badge.field === field}
              onClick={() => set('field', field)}
              label={BADGE_FIELD_LABELS[field]}
              testId={`badge-field-${field}`}
            >
              <FactionBadge badge={{ ...badge, field }} size={26} />
            </Swatch>
          ))}
        </Row>

        {/* Only once there is a pattern to colour. Shown greyed rather than hidden would be a row
            of controls that do nothing, and hiding it is how the panel stays the size of its
            decisions. */}
        {badge.field === 'plain' && <div aria-hidden className="hidden sm:block" />}
        {badge.field !== 'plain' && (
          <Row label="Pattern colour">
            {BADGE_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                selected={badge.fieldColor === color}
                onClick={() => set('fieldColor', color)}
                testId={`badge-field-color-${color}`}
              />
            ))}
          </Row>
        )}

        <Row label="Emblem" wide>
          {BADGE_PROPS.map((prop) => (
            <Swatch
              key={prop}
              selected={badge.prop === prop}
              onClick={() => set('prop', prop)}
              label={BADGE_PROP_LABELS[prop]}
              testId={`badge-prop-${prop}`}
            >
              <PropGlyph prop={prop} color={BADGE_COLOR_VALUES[badge.ink].hex} size={24} />
            </Swatch>
          ))}
        </Row>

        {badge.prop !== 'blank' && (
          <Row label="Emblem colour" wide>
            {BADGE_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                selected={badge.ink === color}
                onClick={() => set('ink', color)}
                testId={`badge-ink-${color}`}
              />
            ))}
          </Row>
        )}

        {/* A warning, not a refusal: it is their badge. The one thing worth saying is that the
            emblem they chose is currently invisible, which is not obvious from a swatch. */}
        {!legible && (
          <p
            role="status"
            data-testid="badge-illegible"
            className="font-body text-[12px] leading-snug text-brass-300"
          >
            The emblem is the same colour as what is behind it, so it cannot be seen. Still allowed,
            in case that is the point.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  /** Takes the whole line rather than half of it: for the eighteen emblems and their colours. */
  wide?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Swatch({
  selected,
  onClick,
  label,
  testId,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      data-tip={label}
      data-testid={testId}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-sm border transition-colors',
        selected
          ? 'border-brass-300 bg-brass-300/15 shadow-brass'
          : 'border-surface-600 hover:border-brass-300/60',
      )}
    >
      {children}
    </button>
  );
}

function ColorSwatch({
  color,
  selected,
  onClick,
  testId,
}: {
  color: BadgeColor;
  selected: boolean;
  onClick: () => void;
  testId: string;
}) {
  const { label, hex } = BADGE_COLOR_VALUES[color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      data-tip={label}
      data-testid={testId}
      style={{ backgroundColor: hex }}
      className={cn(
        'h-7 w-7 rounded-sm border-2 transition-transform',
        selected
          ? 'border-brass-300 shadow-brass'
          : 'border-black/50 hover:-translate-y-0.5 hover:border-brass-300/60',
      )}
    />
  );
}
