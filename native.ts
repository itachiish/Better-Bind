/*
 * Better-Bind — native (processus principal / Node).
 * Vérifie la version publiée sur GitHub et télécharge le nouveau build si besoin.
 * Tourne côté Node (le renderer n'a pas accès au système de fichiers).
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const REPO = "itachiish/Better-Bind";
const BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// Fichiers runtime du build (les 9, sans les .map).
const FILES = [
    "patcher.js",
    "preload.js",
    "renderer.js",
    "renderer.css",
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.css",
    "package.json"
];

// Emplacement du build autonome installé par l'exe.
function distDir(): string {
    return join(process.env.LOCALAPPDATA || "", "BetterBind", "dist");
}

// Renvoie le numéro de version publié sur GitHub (ou null si indisponible).
export async function getRemoteVersion(_: any): Promise<number | null> {
    try {
        const res = await fetch(`${RAW}/version.json?_=${Date.now()}`);
        if (!res.ok) return null;
        const data = await res.json() as { version?: number; };
        return typeof data?.version === "number" ? data.version : null;
    } catch {
        return null;
    }
}

// Télécharge tout le build puis l'écrit (tout-ou-rien). true = appliqué.
export async function downloadUpdate(_: any): Promise<boolean> {
    try {
        const dir = distDir();
        if (!dir) return false;

        const buffers: Record<string, Buffer> = {};
        for (const f of FILES) {
            const res = await fetch(`${RAW}/dist/${f}?_=${Date.now()}`);
            if (!res.ok) return false;
            buffers[f] = Buffer.from(await res.arrayBuffer());
        }

        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        for (const f of FILES) writeFileSync(join(dir, f), buffers[f]);
        return true;
    } catch {
        return false;
    }
}
