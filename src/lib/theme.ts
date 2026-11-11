import { writable } from "svelte/store";

export type Theme = "light" | "dark";
const STORAGE_KEY = "tscope.theme";

export const theme = writable<Theme>("light");

function isTheme(value: string | null): value is Theme{
    return value === "light" || value === "dark";
}

function readstoreeTheme(): Theme | null {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return isTheme(value) ? value : null;
    }catch {
        return null;
    }
}

function applyTheme(next: Theme, persist: boolean) {
    theme.set(next);
    document.documentElement.dataset.theme = next;
    if (!persist) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // 保存できなくても、そのまま続ける
    }
}

export function initTheme() {
    applyTheme(readstoreeTheme() ?? "light", false);
    window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY && isTheme(e.newValue))
            applyTheme(e.newValue, false);
    });
}

export function setTheme(next: Theme) {
    applyTheme(next, true);
}