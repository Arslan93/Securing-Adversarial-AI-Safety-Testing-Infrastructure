import { Input } from "../atoms/Input.jsx";
export function FormField({ label, id, hint, ...props }) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
