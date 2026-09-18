import { memo, useLayoutEffect, useRef } from "react";
import { formatMinorUnits } from "./approval-board";

export const amountAnimationMs = 320;

/** Interpolate integer hundredths, without converting the amount to a JS number. */
export function interpolateMinorUnits(from: bigint, to: bigint, progress: number): bigint {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = BigInt(Math.round((1 - (1 - clamped) ** 3) * 1_000_000));
  return from + (to - from) * eased / 1_000_000n;
}

function isDigit(value: string | undefined): value is string {
  return value !== undefined && /\d/.test(value);
}

/** CSS-driven odometer: only changed digits move, so the board never renders per frame. */
export const AnimatedAmount = memo(function AnimatedAmount({ minorUnits, currency }: {
  readonly minorUnits: bigint | null;
  readonly currency: string;
}) {
  const formatted = formatMinorUnits(minorUnits, currency);
  const previous = useRef({ minorUnits, currency, formatted });
  const old = previous.current.currency === currency ? previous.current.formatted : formatted;
  const offset = old.length - formatted.length;
  const changed = minorUnits !== null && previous.current.minorUnits !== null
    && previous.current.currency === currency && previous.current.minorUnits !== minorUnits;

  useLayoutEffect(() => {
    previous.current = { minorUnits, currency, formatted };
  }, [minorUnits, currency, formatted]);

  return <strong className="animated-amount" data-animating={changed ? "true" : undefined}
    data-total-currency={currency} data-total-value={formatted} title={formatted}>
    <span className="amount-accessible">{formatted}</span>
    <span className="amount-visual" aria-hidden="true">
      {Array.from(formatted).map((character, index) => {
        const previousCharacter = old[index + offset];
        const rolls = changed && isDigit(character) && isDigit(previousCharacter) && character !== previousCharacter;
        return <span className={`amount-character ${rolls ? "is-rolling" : ""}`}
          key={`${currency}:${minorUnits ?? "none"}:${index}`}>
          {rolls ? <><span className="amount-digit amount-digit-old">{previousCharacter}</span><span className="amount-digit amount-digit-new">{character}</span></> : character === " " ? "\u00a0" : character}
        </span>;
      })}
    </span>
  </strong>;
});
