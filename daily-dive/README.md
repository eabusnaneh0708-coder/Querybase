# Emillions — Daily Dive

Emillions is a no-sign-in daily trivia game with seven open-ended questions, player-chosen display names, a curated answer/rarity database, saved end-of-round results, and a shared leaderboard. The game does not call a paid AI API.

## Game rules

- Seven questions each day: 2 easy, 2 medium, 2 hard, and 1 expert.
- The built-in curated question bank selects 2 easy, 2 medium, 2 hard, and 1 expert question, then shuffles once when publishing; everyone sees the same order.
- Topics mix approachable tech/pop culture (for example, Nintendo 64 games) with more difficult IT and cybersecurity prompts.
- Players choose a unique 2–20 character display name. A persistent guest ID is stored in that browser.
- Rarity tiers: Common 10, Uncommon 20, Rare 35, Epic 55, Super Rare 80, Legendary 100 points.
- Rarity tiers are curated per accepted answer: Common 10, Uncommon 20, Rare 35, Epic 55, Super Rare 80, Legendary 100. These are designed game tiers, not measured population-frequency claims.
- Final rank thresholds: Daily Diver 0–139; Explorer 140–244; Rare Hunter 245–384; Epic Hunter 385–499; Super Rare 500–599; Legendary 600–700.
- Answer validation uses normalized exact matching against accepted answers in the question bank. This is predictable and free, but answers not listed in the bank are not accepted until the bank is updated.
- Scores and ranks are saved at submission time and do not change retroactively.
- This is a casual guest game, not a high-stakes contest. Guest IDs can be reset by clearing browser storage or using another device.

## Current project files

- `index.html`, `styles.css`, `app.js`: static web app.
- `supabase/schema.sql`: original database schema; already applied in the existing project.
- `supabase/migrations/20261023_emillions_ai_rarity.sql`: additive migration for question metadata, score details, answer-frequency observations, and secure scoring permissions.
- `supabase/functions/emillions-api/index.ts`: curated question-bank generation, name registration, and deterministic answer validation/scoring; no OpenAI key is needed.
- `supabase/schedule-daily.sql`: optional daily scheduler SQL.
- `supabase/disable-legacy-scoring.sql`: final security hardening after the new frontend is live.

## Deploy changes safely

### 1. Apply the database migration

In the Supabase dashboard for project `czpzmreqvmoarzuyvxkn.supabase.co`:

1. Open **SQL Editor**.
2. Open `supabase/migrations/20261023_emillions_ai_rarity.sql` from this folder.
3. Paste the entire file into a new query and run it.
4. Confirm it completes successfully before deploying the new frontend.

This migration preserves existing tables and scores. It adds new columns and an answer-frequency table and updates the public-safe read functions. The old scoring RPC remains available temporarily so the existing live frontend does not break during setup; disable it only after the new frontend and Edge Function are working.

### 2. Configure the Edge Function

Install the Supabase CLI, log in, and link the existing project. Then set secrets (replace the placeholders locally; never commit actual values):

```sh
supabase login
supabase link --project-ref czpzmreqvmoarzuyvxkn
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
supabase secrets set OPENAI_MODEL=gpt-4o-mini
supabase secrets set CRON_SECRET=GENERATE_A_LONG_RANDOM_SECRET
```

The function does not need an OpenAI API key. It needs the project's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Supabase normally provides these to Edge Functions; if any are not present in the function environment, set them through the Supabase dashboard. The service-role key must only be stored as a server-side secret and must never appear in browser code, Git, screenshots, or public messages.

Deploy the function with gateway JWT verification disabled because it performs its own authorization for host generation and uses a separate secret for scheduled generation:

```sh
supabase functions deploy emillions-api --no-verify-jwt
```

Public registration/submission actions are exposed by the function; host generation checks the signed-in user's Supabase profile for the `admin` role. Scheduled generation requires the `x-cron-secret` header.

### 3. Deploy the frontend after the Edge Function works

Merge this PR to the branch connected to Netlify after the migration and Edge Function deployment are complete. Verify the deployed website lets a new guest choose a name, start the round, submit, and see their score.

Then run `supabase/disable-legacy-scoring.sql` in the SQL Editor. This revokes access to the old scoring RPC so all new submissions use the curated answer-bank validation and scoring.

### 4. Generate today's questions

After the migration and function are deployed:

1. Open the website and sign in using the existing trusted host account.
2. Open **Question studio**.
3. Click **Generate today's 7 with AI**.
4. The function generates the 2/2/2/1 difficulty mix, shuffles it, saves it, and publishes the daily round.

If there is already a published challenge for today, the function intentionally leaves it unchanged.

### 5. Schedule automatic daily generation

To generate questions automatically, first enable the Supabase `pg_cron`, `pg_net`, and Vault extensions in the dashboard. Store the Edge Function URL as a Vault secret named `emillions_function_url` and the same random value used for `CRON_SECRET` as a Vault secret named `emillions_cron_secret`. Then run `supabase/schedule-daily.sql` in the SQL Editor. The schedule runs at 09:05 UTC, which is early morning in the US Eastern time zone, and the function calculates the correct Eastern date.

You can inspect scheduled jobs with:

```sql
select * from cron.job;
```

### 6. Publish the website

Merge the reviewed changes to the branch connected to Netlify, or deploy the `daily-dive` folder manually. Verify the deployed site uses the existing Supabase URL and publishable key at the top of `app.js`.

## Security and fairness

- Never place OpenAI or Supabase service-role secrets in `app.js`.
- Public browser requests never receive accepted-answer lists or AI scoring internals.
- AI checks whether an answer fits the question and estimates its likely frequency. The score blends this estimate with actual player answer counts.
- Database uniqueness prevents the same guest ID from submitting twice for the same challenge. Display names are unique case-insensitively.
- A guest identity is persistent only in the same browser storage. Clearing site data or switching devices creates a new identity; stronger identity verification would require optional accounts.
- The rarity estimates are estimates, not verified population surveys. Scores are frozen when submitted.
