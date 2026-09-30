/**
 * The second figure in "bid / you pay" (maintainer, 2026-09-29): what a win would actually cost
 * this crew once its discount comes off. Nothing at all when there is no discount, so a crew
 * without one sees the field it always saw.
 */
export function YouPay({
  bid,
  pay,
  testId,
}: {
  bid: number;
  pay: number | undefined;
  testId: string;
}) {
  if (pay === undefined || pay === bid) return null;
  return (
    <span
      className="shrink-0 font-display text-[14px] font-bold tabular-nums text-verdigris-100"
      data-tip="What you pay if you win, after your discount"
      data-testid={testId}
    >
      / {pay.toLocaleString()}
    </span>
  );
}
