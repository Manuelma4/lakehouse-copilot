# Arena Copilot

Arena Copilot réunit calendrier, résultats, forme des équipes et prévisions dans un espace de recherche sur le football et VALORANT. L’utilisateur peut passer d’une compétition à une rencontre et retrouver les sources derrière une réponse. Le projet associe une interface React et TypeScript, une API FastAPI et un assistant local.

## Choix d’architecture

- **Un contrat entre deux dépôts.** Arena Lakehouse produit des exports immuables. Arena Copilot en vérifie le manifeste, les sommes de contrôle et les schémas avant de les exposer à l’interface et à l’assistant. [Contrat de données](../CONTRACT.md)
- **Des réponses rattachées aux données.** L’assistant utilise des outils en lecture seule et cite les sources consultées. Les prévisions viennent du modèle du lakehouse. L’assistant les explique et vérifie que les pourcentages annoncés correspondent aux probabilités stockées. [Implémentation de l’assistant](../src/arena_copilot/agent.py)
- **Des données dont on connaît les limites.** L’exemple fictif sert à démontrer le parcours complet. L’export OpenFootball rassemble 2 831 rencontres sur dix éditions et conserve les résultats inconnus et la précision des horaires d’origine. Les prévisions de démonstration n’établissent aucune performance prédictive sur les équipes réelles. [Provenance et licences](../DATA_SOURCES.md)

## Reproduire le projet

Le guide de démarrage permet de lancer le parcours sur les jeux de données inclus avec Python 3.11 et Node.js 24, sans compte fournisseur ni modèle téléchargé. Depuis la racine du dépôt, après l’installation indiquée dans le guide, les commandes suivantes vérifient l’export local, les tests Python et les types de l’interface.

```bash
.venv/bin/arena-copilot validate
.venv/bin/python -m pytest -q
cd web
npm run check
```

Le dossier de vérification distingue les tests sur jeux de données contrôlés, les parcours dans le navigateur et les essais avec un modèle local. Le corpus d’évaluation des réponses attend encore une revue humaine. [Démarrage local](../README.md#run-locally) · [Résultats et périmètre des vérifications](evidence/README.md)
