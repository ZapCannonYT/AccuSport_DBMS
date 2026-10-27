# Project Synopsis

**Title:** AccuSports: Early Warning of Performance Decline for Valorant Pro Players
**Course:** DBMS Experiential Learning, Level 3 Project
**Team Members:** Rahul Saran Sharma (SRN PES1UG24AM218), Ayush (SRN PES1UG24AM909)

---

## 1. Problem Statement

Esports teams and fans judge players by a few headline numbers, like K/D or an overall rating. Those numbers are *lagging*: by the time a player's rating has clearly dropped, the team has already lost matches with them.

The underlying skills often slip earlier: damage output, headshot rate, winning opening duels, consistency (KAST). The cause might be a roster move, a role change, fatigue or a new meta. Nobody watches these metrics player by player against *that player's own normal level*. One bad map is noise, and today there is no way to tell it apart from a real, sustained decline.

## 2. Objectives

- Store real professional Valorant match data (VCT 2023 to 2026) in a properly normalised relational database: players, teams, tournaments, series, maps, agents and per-map stats.
- Learn each player's personal baseline for every metric, and detect a sustained decline (or improvement) with the **CUSUM** method from statistical quality control. It runs **inside the database as a trigger**.
- Measure whether the warnings are meaningful, using real events in the data:
  - the lead time before the player's form drops
  - the rating in the following maps
  - how alerts cluster around roster moves and role changes
- Label each alert with its context (roster move, role change, or none), so a decline that is explained by a role change is not mistaken for a skill problem.
- Find players with a similar playstyle using vector similarity search.
- Provide a web application with role-based access (admin, moderator, analyst) and analytical reports.

## 3. Scope

The system covers VCT international and regional league events from 2023 to 2026. 2026 is partial, through Masters London. The data is about 4,100 maps, 1,600 series, 620 players, 80 teams and 50 tournaments, with 8 stats per player per map.

Out of scope:
- live data capture during matches
- ranked or amateur play
- other games

The schema itself is not tied to one game, so another game could be added later.

## 4. Functional Requirements

- **Login.** Users log in; access is controlled by role:
  - **Admin:** manages app accounts and metric definitions, re-syncs the vector index.
  - **Moderator:** reviews the alert queue (acknowledge, resolve, add a note).
  - **Analyst:** views dashboards, player and team pages, and follows a player.
- **Reports:** a dashboard of reports, for example team averages per season, performance by agent role, agent meta, attack vs defence by map, and the detector's validation reports.
- **Player page:** form chart, metric charts with alert markers, alerts with context, seasons, agents, recent maps, and similar players.
- **Team page:** season stats, roster per season, recent series.
- **Re-runnable import:** importing the data again never duplicates a map.

## 5. Database Approach

We use **Option 2: SQL + Vector database**, as two separate systems:

- **PostgreSQL 17 (self-hosted)** holds all structured data in **14 tables**:
  - players, users, teams, tournaments, maps, agents
  - series, map_plays, map_participants
  - metric_definitions, participant_metrics
  - form_ratings, cusum_state, drift_alerts

  The data is highly connected and needs joins, foreign keys, CHECK constraints and transactions. The detector is two triggers inside Postgres, so every alert and form update is written in the same transaction as the map that caused it.
- **Qdrant 1.20 (self-hosted, NoSQL vector database)** stores one 4-dimensional playstyle fingerprint per player: fragging, survival, damage, precision, standardised. It answers "who plays like this pro?" with cosine similarity and payload filters (same role, same region). Postgres is not built for nearest-neighbour search; Qdrant is.
- **Consistency:** Postgres is the single source of truth. Fingerprints are computed by a Postgres view and copied to Qdrant, and the copy can be rebuilt at any time.

## 6. Advanced Database Features

| Feature | Where it is used |
|---|---|
| Transactions | `fn_record_map` stores a map, its 10 players and all their stats atomically |
| Triggers | CUSUM detector, form rating, form-drop linking (3 triggers) |
| Stored functions | `fn_record_map`, `fn_update_cusum`, `fn_update_form`, `fn_link_form_drop`, `fn_alert_context` |
| Views / materialized view | 12 report views, 4 helper views, fingerprint view, `mv_leaderboard` |
| Indexing | B-tree, composite, partial (open alerts) and expression (lower(name)) indexes |
| Constraints | CHECK, UNIQUE (single and multi-column), composite foreign keys, a generated column |
| Window functions | ROW_NUMBER, RANK, LAG, AVG/SUM OVER, MODE() WITHIN GROUP |
| Vector similarity search (NoSQL) | Qdrant cosine kNN with payload filters |

## 7. Technology Stack

- **Frontend/Backend:** Next.js 15 (App Router, Route Handlers), recharts for charts
- **Relational database:** PostgreSQL 17, self-hosted (pgAdmin 4)
- **Vector database:** Qdrant 1.20, self-hosted
- **Auth:** NextAuth.js (credentials) with bcrypt password hashing and role checks in middleware and API routes
- **Data:** Ryan Luong. (2026). Valorant Champion Tour 2021-2026 Data [Dataset]. Kaggle. https://doi.org/10.34740/KAGGLE/DS/4448489 (scraped from VLR.gg), CSV files imported with a Node.js script
- **Config:** environment variables in `.env.local` (never committed)
- **Version control:** Git + GitHub

## 8. Novelty

A personal-baseline CUSUM early-warning detector for pro players, built as database triggers and validated on real events:
- **Alerts near disruptions:** decline alerts are about **53% more frequent within 5 maps of a real roster move** than elsewhere.
- **Lead time:** about 70 to 89% of decline alerts are followed by a measurable form drop, typically 6 to 16 maps later.
- **Context:** every alert is labelled with its context (roster move or role change), so expected dips are separated from real skill declines.

## 9. Expected Outcome

- An analyst can open any pro's page and see their form, where the detector flagged a sustained decline, and why.
- A moderator works through a short, filterable alert queue.
- The reports answer real questions about pro Valorant: team averages, the role meta, map balance, and stars at international events.
- The design shows why a relational database (integrity, triggers, transactions) and a vector database (similarity search) are each the right tool for their part of the data.
