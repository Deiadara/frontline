import { SKILL_NAMES, type Skills } from '@frontline/shared';
import { StatBar } from '../../components/ui/StatBar';

/** The eight skills rendered as labelled 1..20 bars, in the canonical order. */
export function SkillBars({ skills }: { skills: Skills }) {
  return (
    <div className="flex flex-col gap-1">
      {SKILL_NAMES.map((name) => (
        <StatBar key={name} label={name} value={skills[name]} />
      ))}
    </div>
  );
}
