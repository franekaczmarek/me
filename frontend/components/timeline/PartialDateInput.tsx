import type { DateParts } from "@/lib/timeline/dates";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-2 text-base outline-none focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300";

type Props = {
  label: string;
  value: DateParts;
  onChange: (value: DateParts) => void;
};

/** Year (required), month and day (optional): "2015", "June 2015" or "17 June 2015". */
export function PartialDateInput({ label, value, onChange }: Props) {
  const set = (field: keyof DateParts) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...value, [field]: e.target.value };
    if (field === "month" && !next.month) next.day = "";
    onChange(next);
  };

  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">{label}</legend>
      <div className="flex gap-2">
        <input
          aria-label={`${label} year`}
          inputMode="numeric"
          placeholder="Year"
          value={value.year}
          onChange={set("year")}
          className={`${inputClass} w-24`}
        />
        <select aria-label={`${label} month`} value={value.month} onChange={set("month")} className={`${inputClass} flex-1`}>
          <option value="">Month (optional)</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} day`}
          value={value.day}
          onChange={set("day")}
          disabled={!value.month}
          className={`${inputClass} w-20`}
        >
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
