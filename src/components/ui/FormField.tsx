import type { InputHTMLAttributes, ReactNode } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  helper?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  children?: ReactNode; // for a custom input (e.g. <select>) instead of the default <input>
};

export default function FormField({
  label,
  error,
  helper,
  id,
  inputRef,
  children,
  className,
  ...rest
}: FormFieldProps) {
  const fieldId = id ?? `field-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={`ui-field${error ? " ui-field--error" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      {children ?? <input id={fieldId} ref={inputRef} {...rest} />}
      {error ? (
        <span className="ui-field-error" role="alert">{error}</span>
      ) : helper ? (
        <span className="ui-field-helper">{helper}</span>
      ) : null}
    </div>
  );
}
