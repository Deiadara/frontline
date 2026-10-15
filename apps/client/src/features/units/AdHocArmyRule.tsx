import { adHocArmyAt, unitRules } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { UnitCard } from './UnitCard';
import { catalogueOption } from './UnitWindow';

/**
 * The AD HOC ARMY hover (maintainer, 2026-10-09): the robot's own unit card, titled for the rule,
 * above the rule's words. Drawn at the level the crew's Crate Ring gives, or the base robot when
 * the crew does not hold it (`level` absent or 0).
 *
 * The same `UnitCard` every unit is drawn with, from the catalogue (`catalogueOption`), so the
 * robot reads exactly as any other sheet: no price box and no count, because nobody musters one.
 */
export function AdHocArmyScrap({
  rule,
  ink,
}: {
  rule: { label: string; description: string; level?: number | undefined };
  ink: string;
}) {
  const robot = adHocArmyAt(rule.level ?? 0);
  return (
    // Padded, because a card-sized hover is a bare ground made for a unit card alone.
    <div className="flex flex-col gap-2 p-3" data-testid="ad-hoc-army-card">
      <h4 className={cn('font-stamp text-[14px] uppercase leading-none', ink)}>AD HOC ARMY</h4>
      <UnitCard unit={catalogueOption(robot)} garrisoned={0} abroad={0} />
      {/* The robot's own rules as lines, "TAUNT: what it does", the way a rule reads in words. */}
      {unitRules(robot).map((rule) => (
        <p key={rule.id} className="font-body text-[13px] leading-relaxed text-ink-200">
          <span className="font-display font-semibold uppercase tracking-[0.08em] text-brass-300">
            {rule.label}:
          </span>{' '}
          {rule.description}
        </p>
      ))}
      <span aria-hidden className="ink-rule block" />
      <p className="font-body text-[13px] leading-relaxed text-ink-200">{rule.description}</p>
    </div>
  );
}
