import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { cn } from '../../lib/cn';

/**
 * A control somebody drew a box around.
 *
 * The rest of the kit's buttons are filled or outlined rectangles, which is right for the ones a
 * player clicks a hundred times: a Train button should be a button. This one is for the handful of
 * places where the control is a *note to yourself* rather than a machine affordance, and where the
 * surrounding screen is already paper and ink. The border is `.ink-box`, a rectangle drawn with the
 * same displaced stroke as the rules and the discs, so it wobbles and overshoots its own corner.
 *
 * A `Link` rather than a button, because every use of it so far goes somewhere. Give it a `to`.
 */
export function InkButton({
  to,
  icon,
  children,
  className,
  ...rest
}: {
  to: string;
  icon?: IconName;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, 'to' | 'className' | 'children'>) {
  return (
    <Link
      to={to}
      className={cn(
        'ink-box group/ink inline-flex items-center justify-center gap-2 px-5 py-2.5',
        'font-stamp text-[15px] leading-none text-brass-300',
        'transition-all duration-200 hover:text-brass-100 hover:brightness-125',
        className,
      )}
      {...rest}
    >
      {icon && (
        <Icon
          name={icon}
          aria-hidden
          className="h-4 w-4 transition-transform duration-200 group-hover/ink:-rotate-6"
        />
      )}
      {children}
    </Link>
  );
}
