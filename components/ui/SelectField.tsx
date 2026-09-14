import type { SelectHTMLAttributes } from "react";
import { useId } from "react";
import styles from "./TextField.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
}

/**
 * A labelled native `<select>`.
 *
 * Native rather than a custom listbox: WCAG 2.2 asks for an accessible
 * combobox, and the one that is already accessible on every platform,
 * works with a screen reader, works without JavaScript, and gets the
 * phone's own wheel picker for free is the built-in element. A hand-rolled
 * one would be a large amount of ARIA to reimplement what the browser
 * already does correctly.
 *
 * Shares TextField's stylesheet so the two cannot drift apart visually.
 *
 * **`defaultValue` is honoured on every change, not only at mount.** React
 * maps an input's `defaultValue` to its `value` attribute, so a changed one
 * survives the form reset that React 19 performs after a Server Action; a
 * `<select>` has no such attribute, its default lives in which `<option>`
 * carries `selected`, and React sets that at mount only. A form that hands
 * its values back after a rejected submit therefore restored every text
 * field and silently reverted every select to its first render.
 *
 * That is not a cosmetic difference. On the integrations page it meant a
 * rejected Nextcloud connection came back with the provider quietly reset
 * to Paperless — submit again and the household would have got a different
 * kind of connection from the one they asked for, with no indication
 * anything had changed.
 *
 * Remounting on a changed `defaultValue` fixes it in the one place every
 * select in the app goes through. Nothing remounts while a person is using
 * the field, because `defaultValue` only changes when the server sends a
 * different one back.
 */
export function SelectField(props: SelectFieldProps) {
  return <SelectFieldInner key={String(props.defaultValue ?? "")} {...props} />;
}

function SelectFieldInner({ label, options, hint, error, id, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <select
        id={fieldId}
        className={styles.input}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
