# Better-Bind — userplugin Vencord

Une rangée de **boutons-raccourcis** affichée **juste au-dessus du champ de saisie** de Discord.
Un clic envoie une commande texte prédéfinie (par ex. `$m` pour le bot **Mudae**) dans un salon.

> **Principe strict : 1 clic = 1 message envoyé.**
> Aucun envoi automatique, aucune boucle, aucun minuteur, aucun auto-roll.
> Un bouton est strictement équivalent à taper la commande soi-même.

---

## Installation

1. Clone un dépôt **Vencord** et configure un **build de dev** (voir la doc Vencord).
2. Copie ce dossier dans :
   ```
   <Vencord>/src/userplugins/Better-Bind/
   ```
   (il doit contenir `index.tsx`, `style.css`, `README.md`).
3. Compile / injecte :
   ```bash
   pnpm build
   pnpm inject
   ```
   Pour itérer pendant le dev, utilise le build de dev plutôt qu'un rebuild complet.
4. Dans Discord : **Paramètres → Vencord → Plugins → Better-Bind → activer**.
5. (Dev) Active **React Developer Tools** et le **Patch Helper** dans Paramètres → Vencord.

---

## Configuration des boutons (sans recompilation)

Ouvre **Paramètres → Vencord → Plugins → Better-Bind → ⚙ (réglages)**.

Tu as deux moyens de configurer, qui modifient la **même** liste :

### A. Éditeur visuel (recommandé)
Chaque ligne = un bouton, avec les champs :

| Champ          | Rôle                                                            |
|----------------|-----------------------------------------------------------------|
| **Libellé**    | Texte affiché sur le bouton.                                     |
| **Commande**   | Ce qui est envoyé (ex : `$m`).                                   |
| **ID salon**   | Salon cible. **Vide = salon courant** (celui que tu regardes).  |
| **Envoi direct** | Coché = le message part au clic. Décoché = pré-remplissage.    |

Boutons **+ Ajouter** / **Supprimer** pour gérer la liste. Tout est sauvegardé immédiatement.

### B. JSON brut (avancé)
Le réglage **« Configuration JSON brute »** contient un tableau JSON :

```json
[
  { "label": "$m",  "command": "$m",  "channelId": "",                  "send": true,  "tooltip": "Roll Mudae" },
  { "label": "$dk", "command": "$dk", "channelId": "123456789012345678", "send": false, "tooltip": "Daily kakera" }
]
```

- `channelId` **vide** → salon courant ; sinon → ce salon précis.
- `send: true` → envoi direct ; `send: false` → pré-remplissage.
- `send` **absent** → utilise le **mode d'envoi par défaut** (réglage global).
- `tooltip` → info-bulle facultative.

> Si le JSON est invalide, l'éditeur visuel l'indique et conserve la dernière version valide ;
> la barre n'affiche simplement rien plutôt que de casser le chat.

### Réglages globaux
- **Position** : *Au-dessus du champ de saisie* (objectif principal, via patch) **ou** *Dans la rangée d'icônes à droite* (repli ultra-stable).
- **Mode d'envoi par défaut** : *Envoi direct* ou *Pré-remplissage*, utilisé quand un bouton ne précise pas `send`.

---

## Modes d'envoi

- **Envoi direct** : `sendMessage(channelId, { content })` — le message part immédiatement dans le salon cible (courant ou ID).
- **Pré-remplissage** : `insertTextIntoChatInputBox(text)` — la commande est écrite dans le champ **sans être envoyée** ; tu valides avec **Entrée**.

> ⚠ Le pré-remplissage agit sur le champ **actuellement ouvert**. Pour pré-remplir, regarde le bon salon (un `channelId` précis n'a de sens qu'en envoi direct).

---

## Comment récupérer un ID de salon

1. Discord → **Paramètres → Avancés → Mode développeur** : **activer**.
2. **Clic droit sur le salon → « Copier l'identifiant »**.
3. Colle l'ID dans le champ **ID salon** du bouton.

---

## Maintenance du patch (important)

Le mode **« Au-dessus du champ »** repose sur un **patch** d'un composant interne de Discord
(la zone de saisie). Discord étant minifié et mis à jour souvent, **ce patch peut casser**.

Si la barre **n'apparaît plus** (ou qu'une erreur de patch s'affiche au démarrage de Vencord) :

1. Ouvre le **Patch Helper** (Paramètres → Vencord) et **React DevTools** (onglet ⚛ Components).
2. Localise le module qui rend la **zone de saisie** (« channel text area » / formulaire de message).
3. Dans `index.tsx`, ajuste le bloc `patches` :
   - `find` : une **chaîne stable et unique** de ce module (vérifie l'unicité dans le Patch Helper).
   - `replacement.match` : pointe le bon `children:[` du **conteneur** de la zone de saisie.
   - **Ne te base jamais** sur des noms minifiés (`e`, `n`, `i`…) : ils changent à chaque MAJ.
   On passe par `arguments[0]` pour récupérer les props (et donc `.channel`) sans dépendre du nom du paramètre.
4. **Dépannage rapide** : bascule le réglage **Position** sur **« rangée d'icônes »** — ce mode
   utilise l'API officielle `ChatBarButton` et **ne nécessite aucun patch** (zéro maintenance).
   Tu gardes la fonction « 1 clic = 1 commande », seulement à un autre emplacement.

Garde le patch **le plus minimal possible** pour limiter la casse lors des mises à jour.

---

## Critères d'acceptation couverts

- ✅ Barre de boutons **au-dessus du champ de saisie** (mode `above`).
- ✅ Un clic envoie la bonne commande dans le bon salon (courant ou ID configuré).
- ✅ Mode pré-remplissage : écrit la commande **sans l'envoyer**.
- ✅ Boutons configurables depuis les paramètres ; **persistance** via les settings Vencord.
- ✅ Désactiver le plugin retire la barre **sans erreur** (`stop()` nettoie le bouton d'icône, le patch n'est plus appliqué).
- ✅ **Aucun envoi automatique** : `sendMessage` n'est appelé **que** dans `onClick`.

---

## Notes techniques

- `index.tsx` s'exécute **dans le navigateur** (pas d'API Node.js : `fs`, `child_process`…).
  Si un jour tu as besoin de Node, passe par un fichier `native.ts`.
- API Vencord utilisées : `definePlugin` / `OptionType` (`@utils/types`),
  `definePluginSettings` (`@api/Settings`), `sendMessage` / `insertTextIntoChatInputBox` (`@utils/discord`),
  `addChatBarButton` / `removeChatBarButton` (`@api/ChatButtons`), composants communs (`@webpack/common`).
