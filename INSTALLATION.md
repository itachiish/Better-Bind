# Better-Bind — Guide d'installation (pour un nouvel utilisateur)

Ce plugin ajoute une rangée de boutons-raccourcis au-dessus du champ de message
Discord. Un clic = une commande envoyée (ex : `$m` pour Mudae). **Aucun envoi
automatique.**

⚠️ Un userplugin Vencord se **compile depuis les sources**. Il faut donc faire une
petite installation une fois. Compte ~15 min. Suis les étapes dans l'ordre.

---

## 1. Installer les outils nécessaires

- **Node.js** (version LTS) : https://nodejs.org → télécharge et installe.
- **Git** : https://git-scm.com/download/win → installe.
- Ouvre **PowerShell** (menu Démarrer → tape « PowerShell »).
- Active **pnpm** (gestionnaire de paquets) :
  ```powershell
  npm install -g pnpm
  ```

## 2. Récupérer Vencord

Dans PowerShell :
```powershell
cd $HOME\Desktop
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install
```

## 3. Ajouter le plugin Better-Bind

1. Décompresse le dossier **`Better-Bind`** (celui fourni avec ce guide).
2. Place-le dans :
   ```
   Vencord\src\userplugins\Better-Bind\
   ```
   Le dossier doit contenir `index.tsx`, `style.css`, `README.md`.

## 4. Compiler et injecter dans Discord

Toujours dans PowerShell, dans le dossier `Vencord` :
```powershell
pnpm build
```
Puis **ferme complètement Discord** (clic droit sur l'icône près de l'horloge →
Quitter) et lance :
```powershell
pnpm inject
```
- Choisis **Stable** (flèches du clavier + Entrée) quand il le demande.
- Rouvre Discord.

## 5. Activer le plugin

Dans Discord : **Paramètres → Vencord → Plugins → cherche « Better-Bind » → active**.

Les boutons apparaissent au-dessus du champ de message. 🎉

---

## Configurer ses propres boutons

**Paramètres → Vencord → Plugins → Better-Bind → ⚙**

Éditeur visuel (ou JSON brut) avec, par bouton :
- **Libellé** : le texte du bouton.
- **Commande** : ce qui est envoyé (ex : `$m`).
- **ID salon** : laisser **vide** = salon courant ; ou coller un ID précis.
- **Envoi direct** : coché = envoie au clic ; décoché = pré-remplit le champ.

Pour copier un ID de salon : Discord → Paramètres → Avancés → **Mode développeur**,
puis clic droit sur un salon → **Copier l'identifiant**.

## Si les boutons n'apparaissent pas où on veut

Réglage **« Où afficher les boutons »** :
- **Au-dessus de la zone de saisie** (par défaut).
- **Dans la rangée d'icônes à droite** (repli ultra-stable, sans patch).

## Mettre à jour le plugin plus tard

Remplace les fichiers dans `src\userplugins\Better-Bind\`, puis dans `Vencord` :
`pnpm build`, et dans Discord appuie sur **Ctrl+R**.
