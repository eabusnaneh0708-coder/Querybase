// Emillions backend: deterministic answer validation and rarity scoring.
// No OpenAI API or paid AI service is called by this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
  .replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
const safeName = (value: unknown) => String(value || "").normalize("NFKC")
  .replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);

type Tier = "Common" | "Uncommon" | "Rare" | "Epic" | "Super Rare" | "Legendary";
type BankAnswer = { text: string; tier: Tier };
type BankQuestion = { prompt: string; category: string; difficulty: "easy" | "medium" | "hard" | "expert"; answers: BankAnswer[] };

const a = (text: string, tier: Tier = "Common"): BankAnswer => ({ text, tier });
const QUESTION_BANK: BankQuestion[] = [
  { prompt: "Name a Nintendo 64 game.", category: "Retro gaming", difficulty: "easy", answers: [
    a("Super Mario 64"),a("Mario Kart 64"),a("GoldenEye 007"),a("The Legend of Zelda Ocarina of Time","Uncommon"),a("Super Smash Bros","Uncommon"),a("Banjo-Kazooie","Uncommon"),a("Wave Race 64","Rare"),a("Mischief Makers","Legendary"),a("Blast Corps","Rare")
  ]},
  { prompt: "Name a popular video game console.", category: "Gaming", difficulty: "easy", answers: [
    a("PlayStation"),a("Xbox"),a("Nintendo Switch"),a("PlayStation 5","Uncommon"),a("Game Boy","Uncommon"),a("Sega Dreamcast","Rare"),a("Atari Jaguar","Epic"),a("Neo Geo","Legendary")
  ]},
  { prompt: "Name a web browser.", category: "Internet", difficulty: "easy", answers: [
    a("Google Chrome"),a("Microsoft Edge"),a("Mozilla Firefox"),a("Safari","Uncommon"),a("Opera","Rare"),a("Brave","Rare"),a("Vivaldi","Epic"),a("Mosaic","Legendary")
  ]},
  { prompt: "Name a computer operating system.", category: "Computers", difficulty: "easy", answers: [
    a("Windows"),a("macOS"),a("Linux","Uncommon"),a("Android","Uncommon"),a("ChromeOS","Rare"),a("FreeBSD","Rare"),a("Haiku","Epic"),a("TempleOS","Legendary")
  ]},
  { prompt: "Name a computer component that stores files.", category: "Hardware", difficulty: "medium", answers: [
    a("Hard drive"),a("SSD","Uncommon"),a("USB flash drive","Uncommon"),a("NVMe drive","Rare"),a("SD card","Rare"),a("Magnetic tape","Epic"),a("Zip drive","Legendary")
  ]},
  { prompt: "Name a programming language.", category: "Software", difficulty: "medium", answers: [
    a("Python"),a("JavaScript"),a("Java","Uncommon"),a("C++","Uncommon"),a("Rust","Rare"),a("Fortran","Rare"),a("COBOL","Epic"),a("Erlang","Legendary")
  ]},
  { prompt: "Name a company that makes computer processors.", category: "Hardware", difficulty: "medium", answers: [
    a("Intel"),a("AMD","Uncommon"),a("Apple","Uncommon"),a("Qualcomm","Rare"),a("MediaTek","Rare"),a("Ampere Computing","Epic"),a("Loongson","Legendary")
  ]},
  { prompt: "Name a file format used for images.", category: "Computers", difficulty: "medium", answers: [
    a("JPEG"),a("PNG","Uncommon"),a("GIF","Uncommon"),a("WebP","Rare"),a("TIFF","Rare"),a("AVIF","Epic"),a("JPEG XL","Legendary")
  ]},
  { prompt: "Name a virtualization platform or hypervisor.", category: "IT", difficulty: "hard", answers: [
    a("VMware ESXi"),a("Hyper-V","Uncommon"),a("Proxmox VE","Rare"),a("Xen","Rare"),a("KVM","Rare"),a("bhyve","Epic"),a("oVirt","Epic"),a("SmartOS","Legendary")
  ]},
  { prompt: "Name a network protocol used to assign IP addresses automatically.", category: "Networking", difficulty: "hard", answers: [
    a("DHCP"),a("Dynamic Host Configuration Protocol","Uncommon"),a("BOOTP","Rare"),a("DHCPv6","Epic"),a("Zeroconf","Legendary")
  ]},
  { prompt: "Name a database system.", category: "Software", difficulty: "hard", answers: [
    a("MySQL"),a("PostgreSQL","Uncommon"),a("Microsoft SQL Server","Uncommon"),a("SQLite","Rare"),a("CockroachDB","Rare"),a("Firebird","Epic"),a("DuckDB","Epic"),a("Ingres","Legendary")
  ]},
  { prompt: "Name a technology used to encrypt web traffic.", category: "Cybersecurity", difficulty: "hard", answers: [
    a("TLS"),a("SSL","Uncommon"),a("HTTPS","Uncommon"),a("Let's Encrypt","Rare"),a("QUIC","Epic"),a("DTLS","Epic"),a("ECH","Legendary")
  ]},
  { prompt: "Name a Linux filesystem.", category: "IT", difficulty: "expert", answers: [
    a("ext4"),a("XFS","Uncommon"),a("Btrfs","Rare"),a("ZFS","Rare"),a("F2FS","Epic"),a("JFS","Epic"),a("ReiserFS","Super Rare"),a("bcachefs","Legendary")
  ]},
  { prompt: "Name a protocol used to exchange routing information between autonomous systems.", category: "Networking", difficulty: "expert", answers: [
    a("BGP"),a("Border Gateway Protocol","Uncommon"),a("BGP-4","Rare"),a("MP-BGP","Epic"),a("BGP-LS","Legendary")
  ]},
];

function tierPoints(tier: Tier) {
  return ({ Common: 10, Uncommon: 20, Rare: 35, Epic: 55, "Super Rare": 80, Legendary: 100 } as Record<Tier, number>)[tier];
}
function rankFor(score: number) {
  if (score >= 600) return "Legendary";
  if (score >= 500) return "Super Rare";
  if (score >= 385) return "Epic Hunter";
  if (score >= 245) return "Rare Hunter";
  if (score >= 140) return "Explorer";
  return "Daily Diver";
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
  if (nickname.length < 2) return json({ error: "Name must be 2–20 characters." }, 400);
  const { data: existing, error: findError } = await adminDb.from("guest_players").select("guest_id,nickname").ilike("nickname", nickname).maybeSingle();
  if (findError) throw findError;
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
  const { data: current, error: currentError } = await adminDb.from("daily_challenges").select("id,status").eq("challenge_date", date).maybeSingle();
  if (currentError) throw currentError;
  if (current?.status === "published") return json({ message: "Today's challenge is already published.", challenge_date: date, existing: true });
  const selected: BankQuestion[] = [];
  for (const difficulty of ["easy", "medium", "hard", "expert"] as const) {
    const pool = QUESTION_BANK.filter(q => q.difficulty === difficulty);
    const count = difficulty === "expert" ? 1 : 2;
    const shuffledPool = [...pool].sort(() => Math.random() - 0.5);
    selected.push(...shuffledPool.slice(0, count));
  }
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  let challengeId = current?.id;
  if (challengeId) {
    const { error: delError } = await adminDb.from("questions").delete().eq("challenge_id", challengeId);
    if (delError) throw delError;
    const { error: updError } = await adminDb.from("daily_challenges").update({ title: "Emillions Daily Dive", description: "Seven questions. Think beyond the obvious.", status: "draft" }).eq("id", challengeId);
    if (updError) throw updError;
  } else {
    const { data, error } = await adminDb.from("daily_challenges").insert({
      challenge_date: date, title: "Emillions Daily Dive", description: "Seven questions. Think beyond the obvious.", status: "draft",
    }).select("id").single();
    if (error) throw error;
    challengeId = data.id;
  }
  const rows = selected.map((q, i) => ({
    challenge_id: challengeId, position: i + 1, prompt: q.prompt,
    accepted_answers: q.answers.map(item => item.text), base_points: 100,
    category: q.category, difficulty: q.difficulty,
    rarity_model: { answer_tiers: Object.fromEntries(q.answers.map(item => [normalize(item.text), { tier: item.tier, points: tierPoints(item.tier) }])), source: "curated-question-bank" },
  }));
  const { error: insertError } = await adminDb.from("questions").insert(rows);
  if (insertError) throw insertError;
  const { error: publishError } = await adminDb.from("daily_challenges").update({ status: "published" }).eq("id", challengeId);
  if (publishError) throw publishError;
  return json({ message: "Today's seven-question challenge was built from the curated question bank.", challenge_date: date, question_count: 7, order: selected.map(q => ({ prompt: q.prompt, difficulty: q.difficulty })) });
}
async function submitDive(body: any) {
  const guestId = String(body.guest_id || "");
  const answers = body.answers;
  if (!/^[0-9a-f-]{36}$/i.test(guestId) || !answers || typeof answers !== "object" || Array.isArray(answers)) {
    return json({ error: "Player ID or answers are invalid." }, 400);
  }
  const { data: player, error: playerError } = await adminDb.from("guest_players").select("guest_id,nickname").eq("guest_id", guestId).maybeSingle();
  if (playerError) throw playerError;
  if (!player) return json({ error: "Choose your player name before submitting." }, 400);
  const date = todayEastern();
  const { data: challenge, error: challengeError } = await adminDb.from("daily_challenges")
    .select("id,challenge_date,status,questions(id,prompt,position,category,difficulty,accepted_answers,rarity_model)")
    .eq("challenge_date", date).eq("status", "published").maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) return json({ error: "Today's challenge is not published yet." }, 404);
  const { data: previous, error: previousError } = await adminDb.from("submissions").select("id").eq("challenge_id", challenge.id).eq("guest_id", guestId).maybeSingle();
  if (previousError) throw previousError;
  if (previous) return json({ error: "You've already submitted today's dive." }, 409);
  const qs = (challenge.questions || []).sort((x: any, y: any) => x.position - y.position);
  if (qs.length !== 7) return json({ error: "Today's challenge is not configured with seven questions." }, 500);
  const results: Record<string, any> = {};
  let total = 0;
  for (const q of qs) {
    const raw = String(answers[q.id] || "").trim().slice(0, 120);
    if (!raw) {
      results[q.id] = { answer: "", valid: false, tier: "No answer", points: 0 };
      continue;
    }
    const canonical = normalize(raw);
    const accepted = (q.accepted_answers || []).find((value: string) => normalize(value) === canonical);
    if (!accepted) {
      results[q.id] = { answer: raw, valid: false, tier: "Not accepted", points: 0 };
      continue;
    }
    const canonicalAccepted = normalize(accepted);
    const tierInfo = q.rarity_model?.answer_tiers?.[canonicalAccepted] || { tier: "Common", points: 10 };
    const points = Number(tierInfo.points) || 10;
    total += points;
    results[q.id] = { answer: raw, valid: true, normalized_answer: canonicalAccepted, tier: tierInfo.tier || "Common", points };
  }
  const rank = rankFor(total);
  const { data: inserted, error: insertError } = await adminDb.from("submissions").insert({
    challenge_id: challenge.id, guest_id: guestId, answers, total_score: total, results, rank_name: rank,
  }).select("id,submitted_at").single();
  if (insertError) return json({ error: insertError.code === "23505" ? "You've already submitted today's dive." : insertError.message }, insertError.code === "23505" ? 409 : 500);
  for (const q of qs) {
    const r = results[q.id];
    if (!r?.valid || !r.normalized_answer) continue;
    const { error } = await adminDb.rpc("record_answer_observation", {
      p_question_id: q.id, p_normalized_answer: r.normalized_answer, p_answer_display: r.answer,
    });
    if (error) console.error("Could not update answer observations", error.message);
  }
  return json({ id: inserted.id, total_score: total, rank_name: rank, answers, results, submitted_at: inserted.submitted_at, nickname: player.nickname });
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
