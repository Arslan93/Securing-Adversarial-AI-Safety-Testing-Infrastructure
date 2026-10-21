import { Logo } from "../molecules/Logo.jsx";
export function AuthTemplate({ children }) {
  return (
    <div className="login-page">
      <div className="login-brand">
        <Logo />
        <span>Isolation-first AI safety testing</span>
      </div>
      <div className="login-card">{children}</div>
      <span className="login-credit">BAYORA / TEAM MANGO DB</span>
    </div>
  );
}
