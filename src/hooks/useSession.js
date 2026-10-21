import { useState, useRef, useEffect, useCallback } from "react";
import { api, resetSessionToken } from "../lib/api.js";
export function useSession() {
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [data, setData] = useState(null),
    [config, setConfig] = useState(null),
    [initializing, setInitializing] = useState(true),
    [connectionError, setConnectionError] = useState(""),
    [sessionNotice, setSessionNotice] = useState("");
  const generation = useRef(0),
    mounted = useRef(true);
  const clearSession = useCallback((notice = "") => {
    generation.current++;
    resetSessionToken();
    setMfaChallenge(null);
    setData(null);
    setSessionNotice(notice);
    setConnectionError("");
  }, []);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try {
      const next = await api("/state");
      if (mounted.current && version === generation.current) {
        setData(next);
        setConnectionError("");
        return true;
      }
    } catch (error) {
      if (mounted.current && version === generation.current) {
        if (error.status === 401)
          clearSession("Your session expired. Sign in again to continue.");
        else setConnectionError(error.message);
      }
    }
    return false;
  }, [clearSession]);
  const bootstrap = useCallback(async () => {
    setInitializing(true);
    setConnectionError("");
    const version = generation.current;
    try {
      const [settings, session] = await Promise.all([
        api("/config"),
        api("/session"),
      ]);
      if (!mounted.current || version !== generation.current) return;
      setConfig({ ...settings, setupRequired: session.setupRequired });
      if (session.authenticated) await refresh();
    } catch (e) {
      if (mounted.current && version === generation.current)
        setConnectionError(e.message);
    } finally {
      if (mounted.current) setInitializing(false);
    }
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    bootstrap();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [bootstrap]);
  const auth = !!data;
  useEffect(() => {
    if (!auth) return;
    let stopped = false,
      timer;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 1800);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [auth, refresh]);
  async function loginRole(input) {
    const path = mfaChallenge
      ? "/login/mfa"
      : input.invitationToken
        ? "/invitations/register"
        : config?.setupRequired
          ? "/setup"
          : "/login";
    const result = await api(
      path,
      mfaChallenge
        ? { challenge: mfaChallenge, code: input.code }
        : {
            ...input,
            ...(input.invitationToken ? { token: input.invitationToken } : {}),
          },
    );
    if (result.mfaRequired) {
      setMfaChallenge(result.challenge);
      return;
    }
    setMfaChallenge(null);
    setConfig((current) => ({ ...current, setupRequired: false }));
    generation.current++;
    setSessionNotice("");
    if (!(await refresh()))
      throw Error(
        "Sign-in completed, but workspace data could not load. Retry the connection.",
      );
  }
  async function logoutSession() {
    await api("/logout", {});
    clearSession();
  }
  return {
    auth,
    mfaChallenge,
    data,
    config,
    initializing,
    connectionError,
    sessionNotice,
    refresh,
    bootstrap,
    clearSession,
    loginRole,
    logoutSession,
  };
}
