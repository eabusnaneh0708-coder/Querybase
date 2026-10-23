# Daily Dive

Daily Dive is a no-sign-in daily trivia game. Players open the link, answer the daily questions, and appear on a shared leaderboard under an anonymous name such as `Diver-A1B2`.

## How players work

- No player accounts, email addresses, passwords, or public player profiles.
- A random guest ID is saved in that browser for the current day.
- The guest ID rotates on the next day in the America/New_York time zone.
- Scores and submissions are stored in Supabase so the leaderboard is shared across devices.
- The leaderboard refreshes automatically about every 10 seconds while it is open.
- One submission per guest ID per daily challenge is enforced by the database.
- The host uses a separate Supabase login only to create and publish questions.

**Guest IDs are convenience, not strong identity verification.** Someone can clear browser storage, use another browser/device, or deliberately create a new ID. Without player accounts or another verification method, it is not possible to guarantee one entry per real person. This is suitable for a casual daily game, not a high-stakes contest.

## Setup

1. Create a Supabase project at [supabase.com](https://supabase.com/).
2. Open **SQL Editor → New query** in Supabase.
3. Open `supabase/schema.sql` from this folder, copy all of its contents into the SQL Editor, and run it. This creates the tables and secure database functions. It does not create any daily questions yet.
4. In Supabase, open **Project Settings → API** (or the API keys section). Copy the **Project URL** and the **publishable key** (or legacy anon key). Never use a service-role/secret key in the website.
5. Set the two constants at the top of `app.js`:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_ANON_KEY` = your publishable/anon key
6. Deploy the contents of the `daily-dive` folder as a static website (Netlify, GitHub Pages, or another static host). The URL for the site is what you share with players.

You can use the **Database setup** button to test the connection in your own browser before publishing. Values entered there are saved only in that browser; they do not configure other visitors.

## Set up the host account

Players do not sign in. Only the host needs a Supabase Auth account to access Question Studio.

1. In Supabase, open **Authentication → Users** and create a host user (or use the dashboard's invite/create-user flow).
2. Copy that user's UUID from the Users list.
3. In **SQL Editor**, run the following, replacing the sample UUID with the host user's real UUID:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'PASTE-HOST-USER-UUID-HERE';
   ```

4. In Supabase **Authentication → URL Configuration**, add the deployed website URL to the allowed site/redirect URLs.
5. On the game website, click **Host login**, sign in with the host credentials, and open **Question studio**.
6. Create a challenge for today's date (Eastern time), add questions and accepted answers, then click **Publish challenge**.

Only promote trusted host accounts to admin. Do not share host credentials.

## Security notes

- Public players call database functions; they cannot query the accepted-answer column directly through the browser API.
- Answer checking and scoring happen in Postgres.
- Row Level Security remains enabled on the tables.
- Only use the Supabase publishable/anon key in the browser. Never expose a service-role key.
- The host login is still required to manage questions; players never see a login prompt.
- The current rarity scoring awards more points for valid answers that fewer earlier submissions used. Since scores are calculated when a player submits, later submissions do not retroactively recalculate earlier scores.

## Current limitations

- No player accounts or cross-device score recovery.
- A new browser/device has a new guest ID.
- Guests can bypass the one-entry-per-person intention by clearing site data or switching browsers; this is expected for a casual anonymous game.
- The daily challenge date uses America/New_York time.
- Supabase and the hosting provider have free-plan limits.
