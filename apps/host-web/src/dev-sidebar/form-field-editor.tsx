import styles from "../index.module.css";
import type { FormField } from "./contracts";

interface FormFieldEditorProps {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}

export function FormFieldEditor({ field, value, onChange }: FormFieldEditorProps) {
  const normalized = value ?? (field.kind === "boolean" ? false : "");

  if (field.kind === "boolean") {
    return (
      <label className={styles.devField}>
        <span>{field.label}</span>
        <input
          type="checkbox"
          checked={normalized === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }

  if (field.kind === "select") {
    return (
      <label className={styles.devField}>
        <span>{field.label}</span>
        <select
          value={String(normalized)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select...</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }

  if (field.kind === "json") {
    return (
      <label className={styles.devField}>
        <span>{field.label}</span>
        <textarea
          className={styles.devTextarea}
          value={String(normalized)}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }

  const inputType = field.kind === "number" || field.kind === "integer" ? "number" : "text";
  return (
    <label className={styles.devField}>
      <span>{field.label}</span>
      <input
        type={inputType}
        value={String(normalized)}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.description && <small>{field.description}</small>}
    </label>
  );
}
