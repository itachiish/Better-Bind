/*
 * Better-Bind — userplugin Vencord
 * Une rangée de boutons-raccourcis pour envoyer des commandes en 1 clic.
 * Principe strict : 1 clic = 1 message envoyé.
 * AUCUN envoi automatique / boucle / minuteur / auto-roll.
 *
 * Placer ce dossier dans : <Vencord>/src/userplugins/Better-Bind/
 */

import "./style.css";

import { addChatBarButton, ChatBarButton, ChatBarButtonFactory, removeChatBarButton } from "@api/ChatButtons";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { relaunch } from "@utils/native";
import definePlugin, { IconComponent, OptionType, PluginNative } from "@utils/types";
import {
    Button,
    ChannelStore,
    Forms,
    GuildStore,
    IconUtils,
    NavigationRouter,
    React,
    ReactDOM,
    ReadStateStore,
    RestAPI,
    SelectedChannelStore,
    SelectedGuildStore,
    TextInput,
    Toasts,
    Tooltip,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useStateFromStores
} from "@webpack/common";

// ───────────────────────────────────────────────────────────────────────────
// Types & parsing de la configuration
// ───────────────────────────────────────────────────────────────────────────

type BarPosition = "above" | "iconRow";

interface ShortcutButton {
    /** Texte affiché sur le bouton. */
    label: string;
    /** Commande envoyée (ex: "$m"). */
    command: string;
    /** ID du salon cible. Vide => salon courant. */
    channelId?: string;
    /** true = envoi direct, false = pré-remplissage. Absent => mode global. */
    send?: boolean;
    /** Texte d'info-bulle facultatif. */
    tooltip?: string;
    /** Emplacement de ce bouton. Absent => "above". */
    position?: BarPosition;
}

// Emplacement effectif d'un bouton (par défaut : au-dessus).
function btnPos(b: ShortcutButton): BarPosition {
    return b.position === "iconRow" ? "iconRow" : "above";
}

const DEFAULT_BUTTONS: ShortcutButton[] = [
    // Tous dans le salon courant (channelId vide).
    { label: "$m", command: "$m", channelId: "", send: true, tooltip: "Roll Mudae ($m)" },
    { label: "$mk", command: "$mk", channelId: "", send: true, tooltip: "Kakera ($mk)" },
    { label: "$tu", command: "$tu", channelId: "", send: true },
    { label: "$k", command: "$k", channelId: "", send: true },
    // $divorce et $changeimg en pré-remplissage (send: false).
    { label: "$divorce", command: "$divorce", channelId: "", send: false },
    { label: "$changeimg", command: "$changeimg", channelId: "", send: false }
];

// Aucun serveur activé par défaut : chacun choisit les siens via le sélecteur.
const DEFAULT_GUILDS: string[] = [];

function parseGuildList(json: string): string[] {
    if (!json?.trim()) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
    } catch {
        return [];
    }
}

function parseButtons(json: string): ShortcutButton[] {
    if (!json?.trim()) return [];
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(b => b && typeof b.label === "string" && typeof b.command === "string");
    } catch {
        // JSON invalide : on n'affiche rien plutôt que de casser le chat.
        return [];
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Auto-updateur (build combiné téléchargé depuis GitHub)
// ───────────────────────────────────────────────────────────────────────────

const BUILD_VERSION = 1; // ⬅ à incrémenter à chaque publication (doit matcher version.json)

const Native = VencordNative.pluginHelpers["Better-Bind"] as PluginNative<typeof import("./native")>;

async function checkForUpdates(manual = false) {
    try {
        const remote = await Native.getRemoteVersion();
        if (remote == null) {
            if (manual) toast("Impossible de vérifier les mises à jour.", Toasts.Type.FAILURE);
            return;
        }
        if (remote <= BUILD_VERSION) {
            if (manual) toast("Better-Bind est à jour ✅", Toasts.Type.SUCCESS);
            return;
        }
        const ok = await Native.downloadUpdate();
        if (!ok) {
            if (manual) toast("Échec du téléchargement de la mise à jour.", Toasts.Type.FAILURE);
            return;
        }
        showNotification({
            title: "Better-Bind — mise à jour prête",
            body: "Clique ici pour recharger Discord et appliquer la nouvelle version.",
            permanent: true,
            onClick: relaunch
        });
    } catch {
        if (manual) toast("Erreur lors de la vérification des mises à jour.", Toasts.Type.FAILURE);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Réglages
// ───────────────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    configIO: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <ConfigIO />
    },
    secMentions: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <SectionHeader
                title="Bouton @ — mentions non lues"
                subtitle={<>
                    <div><b>Clic gauche</b> → t'amène à la mention non lue la plus ancienne, puis suivante à chaque clic (ancienne → récente).</div>
                    <div><b>Clic droit</b> → va directement à la plus récente et réinitialise le cycle (le prochain clic gauche repart de la plus ancienne).</div>
                </>}
            />
        )
    },
    mentionButton: {
        type: OptionType.BOOLEAN,
        description: "Afficher le bouton « @ » (visible sur TOUS les serveurs et DM)",
        default: true
    },
    mentionPosition: {
        type: OptionType.SELECT,
        description: "Emplacement du bouton @",
        options: [
            { label: "Au-dessus de la zone de saisie", value: "above", default: true },
            { label: "Dans la rangée d'icônes à droite", value: "iconRow" }
        ]
    },
    mentionExcludeEveryone: {
        type: OptionType.BOOLEAN,
        description: "Bouton @ : ignorer les mentions @everyone / @here",
        default: true
    },
    secGuilds: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SectionHeader title="Serveurs actifs" />
    },
    enabledGuilds: {
        type: OptionType.STRING,
        description: "Liste JSON des serveurs où le plugin est actif (géré par le sélecteur ci-dessous)",
        default: JSON.stringify(DEFAULT_GUILDS),
        // Masqué de l'interface : géré uniquement par le sélecteur visuel (n'affiche aucun ID).
        hidden: true
    },
    guildSelector: {
        type: OptionType.COMPONENT,
        description: "Serveurs actifs",
        component: () => <GuildSelector />
    },
    secDisplay: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SectionHeader title="Envoi" subtitle="L'emplacement (au-dessus / rangée d'icônes) se choisit bouton par bouton, ci-dessous." />
    },
    sendMode: {
        type: OptionType.SELECT,
        description: "Mode d'envoi par défaut (si un bouton ne précise pas \"send\")",
        options: [
            { label: "Envoi direct (le message part au clic)", value: "send", default: true },
            { label: "Pré-remplissage (je valide avec Entrée)", value: "prefill" }
        ]
    },
    secButtons: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SectionHeader title="Boutons de commandes" grouped />
    },
    editor: {
        type: OptionType.COMPONENT,
        description: "Éditeur de boutons",
        component: () => <ButtonsEditor />
    },
    buttons: {
        type: OptionType.STRING,
        description: "Configuration JSON brute (avancé) — l'éditeur ci-dessus est plus simple",
        default: JSON.stringify(DEFAULT_BUTTONS)
    }
});

// Clés incluses dans l'import/export de config. On EXCLUT volontairement
// "enabledGuilds" : la sélection de serveurs est personnelle (et contient des IDs).
const CONFIG_KEYS = ["buttons", "mentionButton", "mentionPosition", "mentionExcludeEveryone", "sendMode"] as const;

// Composant Import/Export de la config du plugin (via une zone de texte).
function ConfigIO() {
    const [io, setIo] = useState("");

    function exportConfig() {
        const data: Record<string, any> = { _bb: 1 };
        for (const k of CONFIG_KEYS) data[k] = (settings.store as any)[k];
        const text = JSON.stringify(data);
        setIo(text); // affiché dans la zone (sélectionnable / copiable)
        // Tentative de copie auto (best effort — ignorée si le presse-papier est bloqué).
        try { navigator.clipboard?.writeText?.(text); } catch { }
        toast("Config générée dans la zone ci-dessous (et copiée si autorisé).", Toasts.Type.SUCCESS);
    }

    function importConfig() {
        const text = io.trim();
        if (!text) { toast("Colle d'abord une config dans la zone, puis clique Importer.", Toasts.Type.FAILURE); return; }
        let data: any;
        try { data = JSON.parse(text); } catch { toast("Texte invalide : ce n'est pas une config Better-Bind.", Toasts.Type.FAILURE); return; }
        if (!data || typeof data !== "object") { toast("Config invalide.", Toasts.Type.FAILURE); return; }
        let applied = 0;
        for (const k of CONFIG_KEYS) {
            if (k in data && data[k] !== undefined) { (settings.store as any)[k] = data[k]; applied++; }
        }
        toast(applied ? `Config importée ✅ (${applied} réglages)` : "Aucun réglage reconnu.", applied ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
    }

    return (
        <section className="bb-configio">
            <SectionHeader title="Config du plugin" subtitle="Exporter = génère le texte de ta config dans la zone. Importer = colle un texte de config dans la zone puis applique-le." first />
            <div className="bb-configio-actions">
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={exportConfig}>Exporter</Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={importConfig}>Importer</Button>
            </div>
            <textarea
                className="bb-configio-text"
                placeholder="Colle ici une config à importer — ou clique « Exporter » pour générer la tienne, puis copie le texte."
                value={io}
                onChange={e => setIo(e.target.value)}
                spellCheck={false}
                rows={3}
            />
            <div className="bb-configio-version">
                <span>Version {BUILD_VERSION}</span>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => checkForUpdates(true)}>
                    Vérifier les mises à jour
                </Button>
            </div>
        </section>
    );
}

// Le plugin est-il actif dans ce serveur ? (Les MP — sans serveur — sont autorisés.)
function isGuildEnabled(guildId?: string | null): boolean {
    if (!guildId) return true;
    return parseGuildList(settings.store.enabledGuilds).includes(guildId);
}

// En-tête de section. `first` = pas de séparateur (1re section). `grouped` = pas de
// séparateur car la section continue le même groupe que la précédente.
function SectionHeader({ title, subtitle, first, grouped }: { title: string; subtitle?: React.ReactNode; first?: boolean; grouped?: boolean; }) {
    const showDivider = !first && !grouped;
    return (
        <div className={"bb-section" + (grouped ? " bb-section-grouped" : "")}>
            {showDivider && <div className="bb-divider" />}
            <Forms.FormTitle className="bb-section-title">{title}</Forms.FormTitle>
            {subtitle && <div className="bb-section-sub">{subtitle}</div>}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Action au clic (le SEUL endroit qui envoie un message — toujours sur clic)
// ───────────────────────────────────────────────────────────────────────────

function runButton(btn: ShortcutButton, currentChannelId?: string) {
    const targetChannel = btn.channelId?.trim() || currentChannelId || SelectedChannelStore.getChannelId();
    if (!targetChannel) {
        Toasts.show({ message: "Better-Bind : aucun salon cible.", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        return;
    }

    // Mode : priorité au réglage du bouton, sinon réglage global.
    const direct = typeof btn.send === "boolean" ? btn.send : settings.store.sendMode === "send";

    if (direct) {
        // Envoi immédiat dans le salon cible (courant ou ID configuré).
        sendMessage(targetChannel, { content: btn.command });
    } else {
        // Pré-remplissage : écrit la commande dans le champ courant SANS l'envoyer.
        // (Ne fonctionne que pour le salon actuellement ouvert.)
        insertTextIntoChatInputBox(btn.command);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Bouton « @ » : aller aux mentions NON LUES, de la plus ancienne à la récente
// ───────────────────────────────────────────────────────────────────────────

interface MentionItem { id: string; channelId: string; }

function bigOrZero(id?: string | null): bigint {
    try { return id ? BigInt(id) : 0n; } catch { return 0n; }
}

// Portée courante : un SERVEUR entier (tous ses salons) OU le DM courant.
function mentionScopeKey(): string {
    const g = SelectedGuildStore.getGuildId();
    return g ? "g:" + g : "dm:" + (SelectedChannelStore.getChannelId() ?? "");
}

// Récupère les mentions non lues de la PORTÉE courante (serveur entier, ou DM courant)
// via la boîte « mentions récentes » de Discord (historique ~7 jours).
async function fetchUnreadMentions(): Promise<MentionItem[]> {
    const everyone = !settings.store.mentionExcludeEveryone; // false => exclut @everyone/@here
    const guildId = SelectedGuildStore.getGuildId();
    const currentChannel = SelectedChannelStore.getChannelId();

    const query: any = { limit: 25, roles: true, everyone };
    if (guildId) query.guild_id = guildId; // l'API limite alors les mentions à CE serveur

    let body: any[] = [];
    try {
        const res: any = await RestAPI.get({ url: "/users/@me/mentions", query });
        body = Array.isArray(res?.body) ? res.body : [];
    } catch {
        body = [];
    }

    let items: MentionItem[] = body
        .filter(m => m && m.id && m.channel_id)
        .map(m => ({ id: String(m.id), channelId: String(m.channel_id) }));

    if (guildId) {
        // Serveur : uniquement les salons de CE serveur (sécurité).
        items = items.filter(it => ChannelStore.getChannel(it.channelId)?.guild_id === guildId);
    } else {
        // DM / groupe : uniquement le salon courant.
        items = items.filter(it => it.channelId === currentChannel);
    }

    // Ne garder que les NON LUES (id plus récent que le dernier message lu du salon).
    items = items.filter(it => {
        const ack = ReadStateStore.ackMessageId(it.channelId);
        return !ack || bigOrZero(it.id) > bigOrZero(ack);
    });

    // Tri chronologique : plus ancienne -> plus récente.
    items.sort((a, b) => {
        const A = bigOrZero(a.id), B = bigOrZero(b.id);
        return A < B ? -1 : A > B ? 1 : 0;
    });
    return items;
}

// Petit cache (5 s) pour que le cliquage rapide ne refasse pas l'appel réseau.
const mentionCache = new Map<string, { items: MentionItem[]; ts: number; }>();
// Plus haute mention déjà visitée par PORTÉE (pour avancer ancienne -> récente).
const lastVisited = new Map<string, bigint>();

async function getMentions(key: string): Promise<MentionItem[]> {
    const c = mentionCache.get(key);
    if (c && Date.now() - c.ts < 5000) return c.items;
    const items = await fetchUnreadMentions();
    mentionCache.set(key, { items, ts: Date.now() });
    return items;
}

function toast(message: string, type = Toasts.Type.MESSAGE) {
    Toasts.show({ message, type, id: Toasts.genId() });
}

function jumpToMention(it: MentionItem) {
    // Navigation par URL : ouvre le bon salon/serveur (ou MP) ET saute au message
    // en le surlignant — fonctionne même si on n'est pas dans ce salon (cross-salon).
    const guildId = ChannelStore.getChannel(it.channelId)?.guild_id ?? "@me";
    NavigationRouter.transitionTo(`/channels/${guildId}/${it.channelId}/${it.id}`);
}

// Clic gauche : mention non lue suivante (ancienne -> récente). En fin de liste : rien.
async function onMentionClick() {
    const key = mentionScopeKey();
    const items = await getMentions(key);
    if (!items.length) { lastVisited.delete(key); toast("Aucune mention non lue ici."); return; }

    const last = lastVisited.get(key) ?? 0n;
    const next = items.find(it => bigOrZero(it.id) > last);
    if (!next) { toast("Toutes les mentions non lues ont été vues."); return; }

    lastVisited.set(key, bigOrZero(next.id));
    jumpToMention(next);
}

// Clic droit : aller à la plus récente, et réinitialiser le cycle (prochain clic
// gauche repart de la plus ancienne).
async function onMentionContext() {
    const key = mentionScopeKey();
    mentionCache.delete(key); // force un rafraîchissement
    const items = await getMentions(key);
    if (!items.length) { lastVisited.delete(key); toast("Aucune mention non lue ici."); return; }

    jumpToMention(items[items.length - 1]); // la plus récente
    lastVisited.delete(key);                // réinitialise le cycle
}

// Badge : mentions non lues de la PORTÉE courante (serveur entier ou DM courant).
function useMentionCount(): number {
    return useStateFromStores([ReadStateStore, SelectedChannelStore, SelectedGuildStore], () => {
        const guildId = SelectedGuildStore.getGuildId();
        if (!guildId) {
            // DM / groupe : seulement le salon courant.
            const ch = SelectedChannelStore.getChannelId();
            return ch ? (ReadStateStore.getMentionCount(ch) || 0) : 0;
        }
        // Serveur : somme des mentions de tous SES salons.
        const ids = ReadStateStore.getMentionChannelIds?.() ?? [];
        return ids.reduce((s, id) => {
            const c = ChannelStore.getChannel(id);
            return c?.guild_id === guildId ? s + (ReadStateStore.getMentionCount(id) || 0) : s;
        }, 0);
    });
}

function mentionTooltip(count: number): string {
    return count > 0
        ? `${count} mention(s) non lue(s) · clic : ancienne→récente · clic droit : la plus récente`
        : "Aucune mention non lue ici";
}

function MentionBadge({ count }: { count: number; }) {
    if (count <= 0) return null;
    return <span className="bb-mention-badge">{count > 99 ? "99+" : count}</span>;
}

// Bouton @ pour le mode "au-dessus".
function MentionToolbarButton() {
    const count = useMentionCount();
    return (
        <Tooltip text={mentionTooltip(count)}>
            {tipProps => (
                <Button
                    {...tipProps}
                    className="bb-button bb-mention-button"
                    size={Button.Sizes.SMALL}
                    color={count > 0 ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    onClick={onMentionClick}
                    onContextMenu={(e: any) => { e.preventDefault(); onMentionContext(); }}
                >
                    @<MentionBadge count={count} />
                </Button>
            )}
        </Tooltip>
    );
}

// Bouton @ pour le mode "rangée d'icônes".
function MentionChatBarButton() {
    const count = useMentionCount();
    return (
        <ChatBarButton
            tooltip={mentionTooltip(count)}
            onClick={onMentionClick}
            onContextMenu={(e: any) => { e.preventDefault(); onMentionContext(); }}
        >
            <span className="bb-iconrow-label bb-mention-iconrow">@<MentionBadge count={count} /></span>
        </ChatBarButton>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Rendu de la barre — TOUT via l'API officielle ChatInputButtonAPI (zéro patch
// maison). Les boutons "rangée d'icônes" sont rendus directement ; les boutons
// "au-dessus" sont rendus puis repositionnés au-dessus du <form> par le DOM.
// ───────────────────────────────────────────────────────────────────────────

// Rendu de la barre "au-dessus" (Option B) :
//  - une ligne du bas horizontale (boutons + @ fixe à droite),
//  - le surplus qui ne tient pas s'empile en COLONNE verticale à droite, vers le haut.
// On mesure les largeurs en JS pour savoir combien de boutons tiennent en bas.
function AboveBar({ channel, list, showMention }: { channel?: { id: string; }; list: ShortcutButton[]; showMention: boolean; }) {
    const toolbarRef = useRef<HTMLDivElement>(null);
    const atRef = useRef<HTMLDivElement>(null);
    const btnRefs = useRef<(HTMLElement | null)[]>([]);
    const [split, setSplit] = useState(list.length);

    useLayoutEffect(() => {
        const host = toolbarRef.current?.parentElement; // .bb-above-host
        if (!host) return;
        const recompute = () => {
            const gap = 6;
            const avail = host.clientWidth - 32; // padding 16*2 de l'hôte
            const atW = (showMention && atRef.current) ? atRef.current.offsetWidth + gap : 0;
            let used = atW;
            let k = 0;
            for (let i = 0; i < list.length; i++) {
                const w = btnRefs.current[i]?.offsetWidth ?? 0;
                if (used + w + gap <= avail) { used += w + gap; k++; }
                else break;
            }
            setSplit(prev => (prev === k ? prev : k));
        };
        recompute();
        const ro = new ResizeObserver(recompute);
        ro.observe(host);
        return () => ro.disconnect();
    }, [list, showMention]);

    if (!list.length && !showMention) return null;

    const renderBtn = (btn: ShortcutButton, i: number) => (
        <Tooltip text={btn.tooltip || btn.command} key={i}>
            {tipProps => (
                <span className="bb-btn-wrap" ref={el => { btnRefs.current[i] = el; }}>
                    <Button
                        {...tipProps}
                        className="bb-button"
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={() => runButton(btn, channel?.id)}
                    >
                        {btn.label}
                    </Button>
                </span>
            )}
        </Tooltip>
    );

    const bottom = list.slice(0, split);
    const overflow = list.slice(split);

    return (
        <div className="bb-toolbar" role="toolbar" aria-label="Better-Bind raccourcis" ref={toolbarRef}>
            {overflow.length > 0 && (
                <div className="bb-toolbar-overflow">
                    {overflow.map((btn, j) => renderBtn(btn, split + j))}
                </div>
            )}
            <div className="bb-toolbar-row">
                {bottom.map((btn, i) => renderBtn(btn, i))}
                {showMention && <div className="bb-toolbar-mention" ref={atRef}><MentionToolbarButton /></div>}
            </div>
        </div>
    );
}

// Monte ses enfants dans un bandeau flottant JUSTE AU-DESSUS du <form> de saisie.
// Placement basé sur le DOM réel (closest("form")) : aucun finder/regex maison.
function AbovePortal({ children }: { children: React.ReactNode; }) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);

    useLayoutEffect(() => {
        const form = anchorRef.current?.closest("form");
        if (!form) return;

        const h = document.createElement("div");
        h.className = "bb-above-host";
        document.body.appendChild(h);
        setHost(h);

        const GAP = 5;   // px au-dessus du champ (plus petit = plus bas)
        const XOFF = -2; // décalage horizontal (négatif = vers la gauche)
        const reposition = () => {
            const r = form.getBoundingClientRect();
            if (!r.width) return;
            h.style.left = `${r.left + XOFF}px`;
            h.style.width = `${r.width}px`;
            h.style.bottom = `${window.innerHeight - r.top + GAP}px`;
        };
        reposition();

        const ro = new ResizeObserver(reposition);
        ro.observe(form);
        ro.observe(document.body);
        window.addEventListener("resize", reposition);

        return () => {
            ro.disconnect();
            window.removeEventListener("resize", reposition);
            h.remove();
        };
    }, []);

    return (
        <>
            <span ref={anchorRef} style={{ display: "none" }} aria-hidden="true" />
            {host && ReactDOM.createPortal(children, host)}
        </>
    );
}

// Factory unique enregistrée via addChatBarButton : gère les DEUX emplacements.
const ChatBarButtons: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;

    const { buttons, mentionButton, mentionPosition, enabledGuilds } = settings.use(["buttons", "mentionButton", "mentionPosition", "enabledGuilds"]);
    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());

    // Boutons de commandes : uniquement dans les serveurs sélectionnés (pas les MP).
    // Bouton @ : partout.
    const guildAllowed = !!guildId && parseGuildList(enabledGuilds).includes(guildId);
    const all = guildAllowed ? parseButtons(buttons) : [];
    const iconRowCmds = all.filter(b => btnPos(b) === "iconRow");
    const aboveCmds = all.filter(b => btnPos(b) === "above");
    const mentionIconRow = mentionButton && mentionPosition === "iconRow";
    const mentionAbove = mentionButton && mentionPosition !== "iconRow";
    const hasAbove = aboveCmds.length > 0 || mentionAbove;

    return (
        <>
            {iconRowCmds.map((btn, i) => (
                <ChatBarButton
                    key={"ir" + i}
                    tooltip={btn.tooltip || btn.command}
                    onClick={() => runButton(btn, channel?.id)}
                >
                    <span className="bb-iconrow-label">{btn.label}</span>
                </ChatBarButton>
            ))}
            {mentionIconRow && <MentionChatBarButton />}
            {hasAbove && (
                <AbovePortal>
                    <AboveBar channel={channel} list={aboveCmds} showMention={mentionAbove} />
                </AbovePortal>
            )}
        </>
    );
};

// Icône affichée uniquement dans l'UI des réglages Vencord (toggle du bouton).
const BBIcon: IconComponent = props => (
    <svg
        width={props.width ?? 24}
        height={props.height ?? 24}
        className={props.className}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
    >
        <path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z" />
    </svg>
);

// ───────────────────────────────────────────────────────────────────────────
// Sélecteur de serveurs (recherche + cases à cocher + tout (dé)sélectionner)
// ───────────────────────────────────────────────────────────────────────────

// Acronyme façon Discord (initiales des mots) pour les serveurs sans icône.
function guildAcronym(name: string): string {
    const a = name.replace(/'s /g, " ").replace(/\w+/g, w => w[0]).replace(/\s/g, "");
    return (a || name[0] || "?").slice(0, 3).toUpperCase();
}

function GuildRow({ guild, checked, onToggle }: { guild: any; checked: boolean; onToggle: () => void; }) {
    const iconUrl: string | undefined = guild.icon
        ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 24 })
        : undefined;

    return (
        <label className="bb-guild-row">
            <input type="checkbox" className="bb-guild-check" checked={checked} onChange={onToggle} />
            {iconUrl
                ? <img className="bb-guild-icon" src={iconUrl} alt="" />
                : <span className="bb-guild-icon bb-guild-acronym">{guildAcronym(guild.name)}</span>}
            <span className="bb-guild-name">{guild.name}</span>
        </label>
    );
}

function GuildSelector() {
    const { enabledGuilds } = settings.use(["enabledGuilds"]);
    const selected = new Set(parseGuildList(enabledGuilds));
    const [search, setSearch] = useState("");

    const guilds = (GuildStore.getGuildsArray?.() ?? [])
        .filter(g => g && g.name)
        .sort((a, b) => a.name.localeCompare(b.name));

    // Robustesse : le TextInput "mana" peut renvoyer une string, un event, ou undefined.
    const onSearch = (v: any) =>
        setSearch(typeof v === "string" ? v : (v?.target?.value ?? ""));
    const q = (search ?? "").trim().toLowerCase();
    const filtered = q ? guilds.filter(g => g.name.toLowerCase().includes(q)) : guilds;

    const save = (set: Set<string>) => { settings.store.enabledGuilds = JSON.stringify([...set]); };
    const toggle = (id: string) => {
        const s = new Set(selected);
        s.has(id) ? s.delete(id) : s.add(id);
        save(s);
    };

    // Ne compter que les serveurs sélectionnés DONT l'utilisateur est membre
    // (la config peut contenir des IDs par défaut absents de ses serveurs).
    const selectedCount = guilds.reduce((n, g) => n + (selected.has(g.id) ? 1 : 0), 0);

    return (
        <section className="bb-guilds">
            <Forms.FormText>
                Coche les serveurs sur lesquels afficher la barre de boutons. Dans les serveurs non cochés,
                la barre n'apparaît pas. (Les messages privés ne sont pas concernés.)
            </Forms.FormText>

            <TextInput
                className="bb-guilds-search"
                placeholder="Rechercher un serveur..."
                value={search}
                onChange={onSearch}
            />

            <div className="bb-guilds-actions">
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => save(new Set(guilds.map(g => g.id)))}>
                    Tout sélectionner
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => save(new Set())}>
                    Tout désélectionner
                </Button>
                <span className="bb-guilds-count">{selectedCount} / {guilds.length} sélectionné(s)</span>
            </div>

            <div className="bb-guilds-list">
                {filtered.map(g => (
                    <GuildRow key={g.id} guild={g} checked={selected.has(g.id)} onToggle={() => toggle(g.id)} />
                ))}
                {!filtered.length && <Forms.FormText>Aucun serveur trouvé.</Forms.FormText>}
            </div>
        </section>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Éditeur de configuration (UI dans les paramètres — sans recompilation)
// ───────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode; }) {
    return (
        <div className="bb-field">
            <span className="bb-field-label">{label}</span>
            {children}
        </div>
    );
}

function PositionSegment({ value, onChange }: { value: BarPosition; onChange: (p: BarPosition) => void; }) {
    return (
        <div className="bb-seg" role="group" aria-label="Emplacement du bouton">
            <button
                type="button"
                className={"bb-seg-opt" + (value === "above" ? " bb-seg-active" : "")}
                onClick={() => onChange("above")}
            >
                Au-dessus
            </button>
            <button
                type="button"
                className={"bb-seg-opt" + (value === "iconRow" ? " bb-seg-active" : "")}
                onClick={() => onChange("iconRow")}
            >
                Rangée d'icônes
            </button>
        </div>
    );
}

function ButtonsEditor() {
    const { buttons } = settings.use(["buttons"]);
    const list = parseButtons(buttons);
    const isValidJson = (() => { try { JSON.parse(buttons || "[]"); return true; } catch { return false; } })();
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    const editorRef = useRef<HTMLElement>(null);
    const overIndexRef = useRef<number | null>(null);

    const save = (next: ShortcutButton[]) => {
        settings.store.buttons = JSON.stringify(next);
    };
    const update = (i: number, patch: Partial<ShortcutButton>) => {
        const next = list.slice();
        next[i] = { ...next[i], ...patch };
        save(next);
    };
    // Réordonne : déplace l'élément `from` à la position `to` (les autres se décalent).
    const reorder = (from: number, to: number) => {
        if (from == null || to == null || from === to) return;
        const next = list.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        save(next);
    };

    // Drag & drop "maison" basé sur le POINTEUR (et non le drag natif HTML5, qui
    // bloque la molette pendant le glisser). Ici molette + auto-scroll fonctionnent.
    useEffect(() => {
        if (dragIndex === null) return;

        // Trouver la zone défilante des réglages.
        let el: HTMLElement | null = editorRef.current?.parentElement ?? null;
        while (el) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
            el = el.parentElement;
        }
        const scroller = el;
        document.body.style.userSelect = "none";

        // Borne le défilement à la zone des boutons (recalculé => OK si on ajoute des boutons).
        const clampScroll = (target: number): number | null => {
            if (!scroller || !editorRef.current) return null;
            const rect = scroller.getBoundingClientRect();
            const er = editorRef.current.getBoundingClientRect();
            const pad = 12;
            const minScroll = scroller.scrollTop + (er.top - rect.top) - pad;
            const maxScroll = scroller.scrollTop + (er.bottom - rect.top) - scroller.clientHeight + pad;
            if (maxScroll <= minScroll) return null;
            return Math.max(minScroll, Math.min(maxScroll, target));
        };

        // Index de la carte sous le curseur (selon la moitié haute/basse de chaque carte).
        const indexAt = (y: number): number => {
            const cards = Array.from(editorRef.current?.querySelectorAll(".bb-editor-card") ?? []) as HTMLElement[];
            for (let k = 0; k < cards.length; k++) {
                const r = cards[k].getBoundingClientRect();
                if (y < r.top + r.height / 2) return k;
            }
            return Math.max(0, cards.length - 1);
        };

        const onMove = (e: PointerEvent) => {
            const idx = indexAt(e.clientY);
            overIndexRef.current = idx;
            setOverIndex(idx);
            if (scroller) {
                const rect = scroller.getBoundingClientRect();
                const margin = 60;
                let delta = 0;
                if (e.clientY < rect.top + margin) delta = -12;
                else if (e.clientY > rect.bottom - margin) delta = 12;
                if (delta) { const t = clampScroll(scroller.scrollTop + delta); if (t != null) scroller.scrollTop = t; }
            }
        };
        const onWheel = (e: WheelEvent) => {
            if (!scroller) return;
            const t = clampScroll(scroller.scrollTop + e.deltaY);
            if (t != null) { e.preventDefault(); scroller.scrollTop = t; }
        };
        const onUp = () => {
            const to = overIndexRef.current;
            if (to != null) reorder(dragIndex, to);
            overIndexRef.current = null;
            setDragIndex(null);
            setOverIndex(null);
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("wheel", onWheel, { passive: false });
        document.addEventListener("pointerup", onUp);
        return () => {
            document.body.style.userSelect = "";
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("wheel", onWheel);
            document.removeEventListener("pointerup", onUp);
        };
    }, [dragIndex]);

    return (
        <section className="bb-editor" ref={editorRef}>
            <Forms.FormText className="bb-editor-help">
                Chaque carte = un bouton. « ID salon » vide = salon courant · « Tooltip » vide = la commande ·
                « Envoi direct » décoché = pré-remplissage.
            </Forms.FormText>

            {!isValidJson && (
                <Forms.FormText style={{ color: "var(--text-danger)" }}>
                    ⚠ Le JSON brut est invalide — l'éditeur affiche la dernière version valide.
                </Forms.FormText>
            )}

            {list.map((b, i) => (
                <div
                    className={"bb-editor-card" + (dragIndex === i ? " bb-dragging" : "") + (overIndex === i && dragIndex !== null && dragIndex !== i ? " bb-drop-target" : "")}
                    key={i}
                >
                    <div className="bb-card-head">
                        <span
                            className="bb-drag-handle"
                            title="Glisser pour réordonner"
                            onPointerDown={e => { e.preventDefault(); overIndexRef.current = i; setDragIndex(i); setOverIndex(i); }}
                        >
                            ⠿
                        </span>
                        <span className="bb-card-index">Bouton {i + 1}</span>
                        <button
                            type="button"
                            className="bb-card-delete"
                            title="Supprimer ce bouton"
                            onClick={() => save(list.filter((_, j) => j !== i))}
                        >
                            ✕
                        </button>
                    </div>

                    <div className="bb-editor-grid">
                        <Field label="Libellé">
                            <TextInput placeholder="ex: $m" value={b.label} onChange={(v: string) => update(i, { label: v })} />
                        </Field>
                        <Field label="Commande">
                            <TextInput placeholder="ex: $m" value={b.command} onChange={(v: string) => update(i, { command: v })} />
                        </Field>
                        <Field label="ID salon (vide = courant)">
                            <TextInput placeholder="ID du salon cible" value={b.channelId ?? ""} onChange={(v: string) => update(i, { channelId: v })} />
                        </Field>
                        <Field label="Tooltip (survol)">
                            <TextInput placeholder="vide = la commande" value={b.tooltip ?? ""} onChange={(v: string) => update(i, { tooltip: v })} />
                        </Field>
                    </div>

                    <div className="bb-editor-footer">
                        <Field label="Emplacement">
                            <PositionSegment value={btnPos(b)} onChange={p => update(i, { position: p })} />
                        </Field>
                        <div className="bb-footer-switch">
                            <FormSwitch
                                hideBorder
                                title="Envoi direct"
                                value={typeof b.send === "boolean" ? b.send : settings.store.sendMode === "send"}
                                onChange={(v: boolean) => update(i, { send: v })}
                            />
                        </div>
                    </div>
                </div>
            ))}

            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.GREEN}
                className="bb-add-btn"
                onClick={() => save([...list, { label: "Nouveau", command: "", channelId: "", tooltip: "", position: "above", send: true }])}
            >
                + Ajouter un bouton
            </Button>
        </section>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Plugin
// ───────────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "Better-Bind",
    description: "Raccourcis de commandes en 1 clic + bouton @ vers tes mentions non lues.",
    authors: [{ name: "itachi", id: 0n }],

    // Le mode "rangée d'icônes" passe par cette API Vencord : on la force active.
    dependencies: ["ChatInputButtonAPI"],

    settings,

    // Aucun patch maison : tout passe par l'API officielle ChatInputButtonAPI
    // (déclarée en dépendance). Le placement "au-dessus" est géré en DOM réel.

    start() {
        addChatBarButton("better-bind", ChatBarButtons, BBIcon);
        checkForUpdates(); // vérifie GitHub au démarrage (notif si MAJ dispo)
    },

    stop() {
        removeChatBarButton("better-bind");
    }
});
