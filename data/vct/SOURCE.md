# VCT data source

These CSVs are a subset of **"Valorant Champion Tour 2021-2026 Data"** by Ryan Luong on Kaggle (the full dataset covers 2021-2026; we use the 2023, 2024, 2025 and 2026 folders, with 2026 running up to Valorant Masters London), scraped from vlr.gg.

Files kept per year:

| File | Used for |
|---|---|
| `overview.csv` | per-player, per-map stats: rating, ACS, K/D/A, KAST, ADR, HS%, first kills/deaths, agent, team |
| `maps_scores.csv` | map score, attack/defence rounds, duration |
| `scores.csv` | series score (maps won) |
| `tournaments_stages_matches_games_ids.csv` | vlr.gg tournament, match (series) and game (map) ids |
| `players_ids.csv`, `teams_ids.csv` | vlr.gg player and team ids |

Imported by `scripts/import-vct.mjs`.

**Known limits of the source:**
- There are no dates. The importer orders maps by vlr.gg game id and *estimates* dates within each season.
- About 2 to 6% of rows have a blank ADR, HS% or KAST; those single values are skipped.

## Citation

Ryan Luong. (2026). Valorant Champion Tour 2021-2026 Data [Dataset]. Kaggle. https://doi.org/10.34740/KAGGLE/DS/4448489 (scraped from VLR.gg)

**Licence:** MIT (as stated on the Kaggle dataset's Metadata tab). The MIT licence allows reuse, including in this project, as long as the copyright and licence notice are kept; we keep this citation in the repository and the report.

**Collection methodology (from the Kaggle metadata):** scraped from vlr.gg by web scraping with Python.

## BibTeX

```bibtex
@misc{ryan_luong_2026,
	title={Valorant Champion Tour 2021-2026 Data},
	url={https://www.kaggle.com/ds/4448489},
	DOI={10.34740/KAGGLE/DS/4448489},
	publisher={Kaggle},
	author={Ryan Luong},
	year={2026}
}
```
