import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../lib/api.js";
export function useLocalModels(enabled, onExpired, isolated = false) {
  const [models, setModels] = useState(null);
  const pending = useRef(null);
  const refreshModels = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setModels(null);
    try {
      const result = await api(
        isolated ? "/models?runtime=container" : "/models",
        undefined,
        {
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) setModels(result);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e.status === 401)
        onExpired("Your session expired. Sign in again to continue.");
      else setModels({ available: false, models: [], message: e.message });
    }
  }, [onExpired, isolated]);
  useEffect(() => {
    if (enabled) refreshModels();
    else setModels(null);
    return () => pending.current?.abort();
  }, [enabled, refreshModels]);
  return { models, refreshModels };
}
