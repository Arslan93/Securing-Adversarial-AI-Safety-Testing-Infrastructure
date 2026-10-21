export function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`${variant} ${className}`.trim()} {...props} />;
}
