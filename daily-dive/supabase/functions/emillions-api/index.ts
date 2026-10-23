// Supabase Edge Function for Emillions.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// OPENAI_API_KEY. Optional: OPENAI_MODEL (defaults to gpt-4o-mini), CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const todayEastern = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().trim()
  .replace(/[^\p{L}\p{N}\s'-]/gu, "").replace(/\s+/g, " ");

async function aiJson(system: string, input: unknown) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Supabase Edge Function secrets.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
    }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  const payload = await response.json();
  return JSON.parse(payload.choices?.[0]?.message?.content || "{}");
}

function tierFor(frequency: number) {
  if (frequency >= 0.20) return { tier: "Common", points: 10 };
  if (frequency >= 0.10) return { tier: "Uncommon", points: 20 };
  if (frequency >= 0.03) return { tier: "Rare", points: 35 };
  if (frequency >= 0.01) return { tier: "Epic", points: 55 };
  if (frequency >= 0.001) return { tier: "Super Rare", points: 80 };
  return { tier: "Legendary", points: 100 };
}
function rankFor(score: number) {
  if (score >= 600) return "Legendary";
  if (score >= 500) return "Super Rare";
  if (score >= 385) return "Epic Hunter";
  if (score >= 245) return "Rare Hunter";
  if (score >= 140) return "Explorer";
  return "Daily Diver";
}
function safeName(value: unknown) {
  return String(value || "").normalize("NFKC").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}
async function isAdminRequest(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: profile } = await adminDb.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin";
}

async function registerPlayer(body: any) {
  const guestId = String(body.guest_id || "");
  const nickname = safeName(body.nickname);
  if (!/^[0-9a-f-]{36}$/i.test(guestId)) return json({ error: "Invalid player ID." }, 400);
  if (nickname.length < 2 || nickname.length > 20) return json({ error: "Name must be 2–20 characters." }, 400);
  const { data: existing } = await adminDb.from("guest_players").select("guest_id,nickname").ilike("nickname", nickname).maybeSingle();
  if (existing && existing.guest_id !== guestId) return json({ error: "That name is already taken. Try another one." }, 409);
  const { error } = await adminDb.from("guest_players").upsert({
    guest_id: guestId, nickname, last_seen_at: new Date().toISOString(),
  }, { onConflict: "guest_id" });
  if (error) return json({ error: error.code === "23505" ? "That name is already taken. Try another one." : error.message }, error.code === "23505" ? 409 : 500);
  return json({ guest_id: guestId, nickname });
}

async function generateDaily(req: Request) {
  const cronToken = req.headers.get("x-cron-secret") || "";
  const isCron = !!CRON_SECRET && cronToken === CRON_SECRET;
  if (!isCron && !(await isAdminRequest(req))) return json({ error: "Host admin access required." }, 401);
  const date = todayEastern();
  const { data: current } = await adminDb.from("daily_challenges").select("id,status").eq("challenge_date", date).maybeSingle();
  if (current?.status === "published") return json({ message: "Today's challenge is already published.", challenge_date: date, existing: true });

  const { data: prior } = await adminDb.from("questions").select("prompt,daily_challenges!inner(challenge_date)")
    .gte("daily_challenges.challenge_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).limit(250);
  const recentPrompts = (prior || []).map((q: any) => q.prompt);
  const generated = await aiJson(
    "You create daily open-ended trivia for Emillions, a friendly tech-and-pop-culture rarity game. Return JSON only with a questions array of exactly seven objects: prompt, category, difficulty, accepted_answers. Difficulty counts must be exactly 2 easy, 2 medium, 2 hard, 1 expert. Use clear everyday language; topics can include retro games (Nintendo 64), consumer tech, computers, internet, cybersecurity, IT support, software, hardware, and virtualization. Questions should have many defensible answers, not multiple choice, and must be answerable without current news. Keep expert questions understandable even if technically difficult. Avoid duplicates and near-duplicates from recent prompts. accepted_answers should contain 8-20 representative valid answers or answer variants for baseline compatibility; never include unsafe instructions. Avoid subjective prompts with no reliable validation.",
    { date, recent_prompts: recentPrompts }
  );
  if (!Array.isArray(generated.questions) || generated.questions.length !== 7) throw new Error("AI did not return exactly seven questions.");
  const counts = generated.questions.reduce((acc: Record<string, number>, q: any) => {
    acc[String(q.difficulty || "").toLowerCase()] = (acc[String(q.difficulty || "").toLowerCase()] || 0) + 1; return acc;
  }, {});
  if (counts.easy !== 2 || counts.medium !== 2 || counts.hard !== 2 || counts.expert !== 1) {
    throw new Error("AI returned an invalid difficulty mix. Please generate again.");
  }
  // Shuffle once at creation; all players get the same saved order.
  const qs = generated.questions.map((q: any) => ({
    prompt: String(q.prompt || "").trim(),
    category: String(q.category || "Technology").slice(0, 60),
    difficulty: String(q.difficulty).toLowerCase(),
    accepted_answers: Array.isArray(q.accepted_answers) ? q.accepted_answers.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 30) : [],
    base_points: 100,
    rarity_model: { provider: "openai", model: OPENAI_MODEL, created_at: new Date().toISOString() },
  }));
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  if (qs.some(q => !q.prompt || !q.accepted_answers.length)) throw new Error("AI returned a question without a prompt or baseline answers.");
  let challengeId = current?.id;
  if (challengeId) {
    const { error: delError } = await adminDb.from("questions").delete().eq("challenge_id", challengeId);
    if (delError) throw delError;
    const { error: updError } = await adminDb.from("daily_challenges").update({
      title: "Emillions Daily Dive", description: "Seven questions. Think beyond the obvious.", status: "draft",
    }).eq("id", challengeId);
    if (updError) throw updError;
  } else {
    const { data, error } = await adminDb.from("daily_challenges").insert({
      challenge_date: date, title: "Emillions Daily Dive",
      description: "Seven questions. Think beyond the obvious.", status: "draft",
    }).select("id").single();
    if (error) throw error; challengeId = data.id;
  }
  const rows = qs.map((q, i) => ({ ...q, challenge_id: challengeId, position: i + 1 }));
  const { error: insertError } = await adminDb.from("questions").insert(rows);
  if (insertError) throw insertError;
  const { error: publishError } = await adminDb.from("daily_challenges").update({ status: "published" }).eq("id", challengeId);
  if (publishError) throw publishError;
  return json({ message: "Today's Emillions challenge is published.", challenge_date: date, question_count: 7, order: qs.map(q => ({ prompt: q.prompt, difficulty: q.difficulty })) });
}

async function submitDive(body: any) {
  const guestId = String(body.guest_id || "");
  const answers = body.answers;
  if (!/^[0-9a-f-]{36}$/i.test(guestId) || !answers || typeof answers !== "object" || Array.isArray(answers)) {
    return json({ error: "Player ID or answers are invalid." }, 400);
  }
  const { data: player } = await adminDb.from("guest_players").select("guest_id,nickname").eq("guest_id", guestId).maybeSingle();
  if (!player) return json({ error: "Choose your player name before submitting." }, 400);
  const date = todayEastern();
  const { data: challenge, error: challengeError } = await adminDb.from("daily_challenges").select("id,challenge_date,status,questions(id,prompt,position,category,difficulty)")
    .eq("challenge_date", date).eq("status", "published").maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) return json({ error: "Today's challenge is not published yet." }, 404);
  const { data: previous } = await adminDb.from("submissions").select("id").eq("challenge_id", challenge.id).eq("guest_id", guestId).maybeSingle();
  if (previous) return json({ error: "You've already submitted today's dive." }, 409);

  const qs = (challenge.questions || []).sort((a: any, b: any) => a.position - b.position);
  if (qs.length !== 7) return json({ error: "Today's challenge is not configured with seven questions." }, 500);
  const results: Record<string, any> = {};
  let total = 0;
  for (const q of qs) {
    const raw = String(answers[q.id] || "").trim().slice(0, 120);
    if (!raw) {
      results[q.id] = { answer: "", valid: false, tier: "No answer", points: 0, frequency: null };
      continue;
    }
    const ai = await aiJson(
      "You validate one answer for an open-ended trivia game and estimate how common this exact valid answer is among ordinary English-speaking internet users who understand the question. Return JSON only: valid (boolean), normalized_answer (short canonical form), estimated_frequency (number from 0.0001 to 1, probability that a random respondent gives this same answer), reason (brief). Be conservative: use commonness, not how impressive or obscure the answer sounds. Accept reasonable synonyms, alternate spellings, equivalent product names and technically correct answers. Reject unrelated, nonsense, or non-responsive answers. Do not give instructions for exploitation; this is classification only. Estimate likely population frequency, not observed game frequency.",
      { question: q.prompt, category: q.category, difficulty: q.difficulty, submitted_answer: raw }
    );
    if (!ai.valid) {
      results[q.id] = { answer: raw, valid: false, tier: "Not accepted", points: 0, frequency: null };
      continue;
    }
    const canonical = normalize(String(ai.normalized_answer || raw)).slice(0, 120) || normalize(raw);
    const aiFrequency = Math.min(1, Math.max(0.0001, Number(ai.estimated_frequency) || 0.1));
    const { data: observation } = await adminDb.from("answer_observations").select("occurrences")
      .eq("question_id", q.id).eq("normalized_answer", canonical).maybeSingle();
    const { data: allObs } = await adminDb.from("answer_observations").select("occurrences").eq("question_id", q.id);
    const matchingCount = Number(observation?.occurrences || 0);
    const observedTotal = (allObs || []).reduce((sum: number, row: any) => sum + Number(row.occurrences || 0), 0);
    // Twenty virtual responses provide a stable AI prior until real submissions accumulate.
    const frequency = (aiFrequency * 20 + matchingCount) / (20 + observedTotal);
    const tier = tierFor(frequency);
    total += tier.points;
    results[q.id] = { answer: raw, valid: true, normalized_answer: canonical, tier: tier.tier, points: tier.points, frequency: Number(frequency.toFixed(5)) };
  }
  const rank = rankFor(total);
  const { data: inserted, error: insertError } = await adminDb.from("submissions").insert({
    challenge_id: challenge.id, guest_id: guestId, answers, total_score: total, results, rank_name: rank,
  }).select("id,submitted_at").single();
  if (insertError) return json({ error: insertError.code === "23505" ? "You've already submitted today's dive." : insertError.message }, insertError.code === "23505" ? 409 : 500);

  for (const q of qs) {
    const r = results[q.id];
    if (!r?.valid || !r.normalized_answer) continue;
    const { data: old } = await adminDb.from("answer_observations").select("occurrences").eq("question_id", q.id).eq("normalized_answer", r.normalized_answer).maybeSingle();
    const { error } = await adminDb.from("answer_observations").upsert({
      question_id: q.id, normalized_answer: r.normalized_answer, answer_display: r.answer,
      occurrences: Number(old?.occurrences || 0) + 1, updated_at: new Date().toISOString(),
    }, { onConflict: "question_id,normalized_answer" });
    if (error) console.error("Could not update rarity observations", error.message);
  }
  return json({
    id: inserted.id, total_score: total, rank_name: rank, answers, results,
    submitted_at: inserted.submitted_at, nickname: player.nickname,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const body = await req.json();
    switch (body.action) {
      case "register": return await registerPlayer(body);
      case "submit": return await submitDive(body);
      case "generate": return await generateDaily(req);
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
