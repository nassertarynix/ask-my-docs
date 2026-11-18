import type { ReactNode } from 'react';

export interface RadioOption<T extends string> {
  value: T;
  title: string;
  hint?: string;
  icon?: ReactNode;
}

/** A row of big selectable cards (one choice). Styled by .choice-group / .choices in styles.css. */
export function RadioCards<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: readonly RadioOption<T>[]; onChange: (value: T) => void }) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <div className={`choices choices-${Math.min(options.length, 4)}`}>
        {options.map((option) => (
          <label className="choice" key={option.value}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span className="choice-box">
              {option.icon}
              <strong>{option.title}</strong>
              {option.hint && <small>{option.hint}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
