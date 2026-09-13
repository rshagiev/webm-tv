import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
const values = [60, 180, 300, 600];
export function DurationMenu({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, values.indexOf(value))]?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="duration-menu"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className="duration-trigger"
        aria-label="Минимальная длительность"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {value / 60}+ мин <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          className="duration-options"
          role="menu"
          aria-label="Минимальная длительность"
          onKeyDown={(e) => {
            const current = items.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let index = current;
            if (e.key === "ArrowDown") index = (current + 1) % values.length;
            else if (e.key === "ArrowUp")
              index = (current + values.length - 1) % values.length;
            else if (e.key === "Home") index = 0;
            else if (e.key === "End") index = values.length - 1;
            else return;
            e.preventDefault();
            items.current[index]?.focus();
          }}
        >
          {values.map((n, i) => (
            <button
              key={n}
              ref={(el) => {
                items.current[i] = el;
              }}
              role="menuitemradio"
              aria-checked={value === n}
              tabIndex={-1}
              onClick={() => {
                onChange(n);
                close();
              }}
            >
              <span>{n / 60}+ мин</span>
              {value === n && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
