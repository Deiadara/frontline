import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_LABELS,
  attributeTier,
  type AttributeGroup,
  type AttributeName,
  type Attributes,
  type AttributeTier,
} from '@frontline/shared';

const GROUP_LABELS: Record<AttributeGroup, string> = {
  physical: 'Physical',
  mental: 'Mental',
  social: 'Social',
  technical: 'Technical',
};

/** Weak reads hostile, strong reads like the player's own accent. */
const TIER_TEXT: Record<AttributeTier, string> = {
  elite: 'text-hextech-100',
  strong: 'text-brass-300',
  average: 'text-ink-200',
  weak: 'text-oxblood-300',
};

function AttributeRow({ name, value }: { name: AttributeName; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      {/* Named from the shared table, not title-cased here: two of the attributes are not what a
          naive capitalise produces, and a sheet spelled differently on two screens is the kind of
          thing nobody reports and everybody sees. Bumped a size and a shade: at 10px in `ink-300`
          the label was the least legible text in the game, next to the number it belongs to. */}
      <span className="truncate font-body text-[12px] leading-[1.15] text-ink-200">
        {ATTRIBUTE_LABELS[name]}
      </span>
      <span
        className={`shrink-0 font-display text-[12px] font-bold leading-[1.15] tabular-nums ${TIER_TEXT[attributeTier(value)]}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The full sheet, Football-Manager style: every attribute the character has, in its group
 * (GDD §B4a). Every human carries every attribute (§B6), so nothing here is filtered by role —
 * and nothing here hints at which role the character would suit (§B8).
 */
export function AttributeSheet({ attributes }: { attributes: Attributes }) {
  return (
    <div className="grid grid-cols-4 gap-x-3">
      {ATTRIBUTE_GROUPS.map((group) => (
        <div key={group} className="min-w-0">
          <p className="mb-0.5 truncate border-b border-surface-600 pb-0.5 font-display text-[8px] uppercase tracking-[0.18em] text-brass-300">
            {GROUP_LABELS[group]}
          </p>
          {ATTRIBUTES_BY_GROUP[group].map((name) => (
            <AttributeRow key={name} name={name} value={attributes[name]} />
          ))}
        </div>
      ))}
    </div>
  );
}
