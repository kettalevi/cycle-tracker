import { emptyData, normalizeData } from "./cycle.js";

const KEY = "cycle-tracker:v1";

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeData(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

/** Returns false if the browser refused to store (private mode, quota). */
export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
