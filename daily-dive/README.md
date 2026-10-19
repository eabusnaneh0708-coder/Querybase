# Daily Dive

A multiplayer daily open-ended trivia game inspired by the *rarity answer* format. Players answer the same daily questions, submit once, and compete on a shared leaderboard. Hosts create and publish challenges in Question Studio.

## Features

- Email/password player accounts and public display names
- Daily challenge with any number of host-created questions
- Shared leaderboard for today's challenge and all-time submissions
- Supabase/Postgres database with server-side scoring
- Host-only Question Studio for drafting and publishing questions
- One submission per player per daily challenge
- Row Level Security policies for data access

## Quick start

1. Create a project at [Supabase](https://supabase.com/).
2. Open **SQL Editor** in your project and run all of `supabase/schema.sql`.
3. Open `index.html` in a browser or deploy the `daily-dive` folder as a static site.
4. Click **Database setup** and enter your Supabase Project URL and publishable/anon key. Those values are stored in that browser only. For a public deployment, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of `app.js` before publishing so all visitors connect to the same database.
5. In Supabase **Authentication → URL Configuration**, set your deployed site URL and allowed redirect URLs. Configure email confirmation as desired.
6. Create an account in the game. In Supabase SQL Editor, promote that account to admin using its Auth user UUID:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'YOUR_AUTH_USER_UUID';
   ```

   Find the UUID in **Authentication → Users**. Only do this for trusted hosts. The browser app never allows users to promote themselves.
7. Sign in as the admin and open **Question studio** to create, save, and publish a challenge.

## Hosting

The site is static and can be hosted on GitHub Pages, Netlify, or Vercel. For GitHub Pages, enable Pages for the repository and use the `/daily-dive` path (or move the contents of this folder to the repository root if you want the game at the root URL).

## Scoring notes

Answers are checked against the accepted answer list configured by the host. Correct answers score more when fewer submitted answers match, with a maximum of the question's base points. This is a starter scoring model; if you want exact duplicate-count rarity scoring, synonym support, or automatic spelling tolerance, adjust the SQL scoring function before launch.

## Important production notes

- The Supabase anon/publishable key is intended for client use; never put a service-role key in browser code.
- Keep Row Level Security enabled. Review the policies before opening the game publicly.
- This starter calculates a score at submission time. For a high-stakes competition, use a server-side Edge Function and a finalized scoring window so later submissions cannot affect earlier scores.
- Leaderboard rows are only visible to signed-in users in this starter.
