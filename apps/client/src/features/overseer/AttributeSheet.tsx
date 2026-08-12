import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
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
  strong: 'text-neon-cyan',
  average: 'text-steel-200',
  weak: 'text-neon-magenta',
};

function AttributeRow({ name, value }: { name: AttributeName; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="truncate font-body text-[10px] leading-[1.35] text-steel-400">{name}</span>
      <span
        className={`shrink-0 font-display text-[10px] font-semibold leading-[1.35] tabular-nums ${TIER_TEXT[attributeTier(value)]}`}
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
          <p className="mb-1 truncate border-b border-steel-700 pb-0.5 font-display text-[8px] uppercase tracking-[0.18em] text-neon-cyan/70">
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
