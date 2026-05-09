# Bilan-ibf

Page GitHub Pages pour suivre les adhérents qui doivent faire leur bilan à partir d'une base Notion.

## Pourquoi `Failed to fetch`

Notion ne se laisse pas appeler proprement depuis une page GitHub Pages avec un token collé dans le navigateur.

La solution de ce dépôt :

- GitHub Actions lit Notion côté serveur
- le workflow génère `data/bilans.json`
- la page `index.html` lit ce fichier JSON
- aucun token n'est exposé sur le site

## Ce que fait la logique

- garde uniquement le bilan le plus récent de chaque personne
- `Bilan 1` => prochain bilan dans `1 mois`
- `Bilan 2` et plus => prochain bilan dans `2 mois`
- si une colonne `Fréquence bilan` existe, elle prend la priorité

## Structure Notion attendue

- `Bilan` : nom complet
- `Unnamed: 1` : par exemple `Bilan 1`, `Bilan 2`, `Bilan 3`
- `Date` : date du dernier bilan
- `Statut` : optionnel
- `Fréquence bilan` : optionnel

## Mise en place simple

1. Ouvrez le repo GitHub `Dblp01/Bilan-ibf`
2. Allez dans `Settings` → `Secrets and variables` → `Actions`
3. Cliquez sur `New repository secret`
4. Créez le secret `NOTION_TOKEN`
5. Collez votre token Notion dedans
6. Facultatif : créez `NOTION_DATABASE_ID` si vous voulez surcharger l'ID déjà présent dans le code
7. Allez dans l'onglet `Actions`
8. Ouvrez le workflow `Sync Notion data`
9. Cliquez sur `Run workflow`
10. Attendez la fin du job puis rechargez le site GitHub Pages

## Fichiers importants

- `index.html` : interface du site
- `data/bilans.json` : données synchronisées servies par GitHub Pages
- `scripts/sync-notion.mjs` : script qui lit Notion
- `.github/workflows/sync-notion.yml` : synchronisation automatique toutes les 6 heures

## Sécurité

Le token Notion ne doit jamais être collé dans la page publique ni commité dans GitHub.

Notion recommande de garder les tokens privés et de les stocker comme secrets ou variables d'environnement :

- [Best practices for handling API keys](https://developers.notion.com/guides/get-started/handling-api-keys)
- [Internal connections](https://developers.notion.com/guides/get-started/internal-connections)
