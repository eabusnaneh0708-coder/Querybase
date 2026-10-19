/* Daily Dive
 * Configure a Supabase project in the Database setup dialog or set SUPABASE_URL
 * and SUPABASE_ANON_KEY below before deploying for all players.
 */
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const today = () => new Date().toLocaleDateString("en-CA");
let db = null, user = null, profile = null, questions = [], answers = {}, currentQuestion = 0, existingSubmission = null, authMode = "signin", isAdmin = false;

function initDb() {
  const url = localStorage.getItem("dd_supabase_url") || SUPABASE_URL;
  const key = localStorage.getItem("dd_supabase_key") || SUPABASE_ANON_KEY;
  if (!url || !key || !window.supabase) { db = null; return false; }
  db = window.supabase.createClient(url, key);
  return true;
}
function escapeHtml(s="") { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function setMessage(selector, msg, error=false) { const el=$(selector); el.textContent=msg; el.classList.toggle("error",error); }
function showView(name) {
  $$(".view").forEach(v=>v.classList.add("hidden"));
  $("#view-"+name).classList.remove("hidden");
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="leaderboard") loadLeaderboard();
  if(name==="admin") renderAdmin();
}
$$(".nav-link").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$("#login-open").addEventListener("click",()=>openAuth());
$("#setup-open").addEventListener("click",()=>$("#setup-dialog").showModal());
$("#leaderboard-period").addEventListener("change",loadLeaderboard);

$("#config-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const url=$("#config-url").value.trim().replace(/\/$/,""), key=$("#config-key").value.trim();
  localStorage.setItem("dd_supabase_url",url); localStorage.setItem("dd_supabase_key",key);
  if(!initDb()){setMessage("#config-message","Could not initialize Supabase. Check the URL and key.",true);return;}
  setMessage("#config-message","Connected to Supabase. Loading challenge…");
  await boot();
  setTimeout(()=>$("#setup-dialog").close(),700);
});
function openAuth(){ if(!db){ $("#setup-dialog").showModal(); return; } authMode="signin"; renderAuthMode(); $("#auth-dialog").showModal(); }
function renderAuthMode(){
  const signup=authMode==="signup";
  $("#auth-title").textContent=signup?"Create your player account":"Welcome back";
  $("#auth-subtitle").textContent=signup?"Pick a name and join the leaderboard.":"Sign in to save your scores and compete.";
  $("#nickname-wrap").classList.toggle("hidden",!signup);
  $("#auth-password").autocomplete=signup?"new-password":"current-password";
  $("#auth-submit").textContent=signup?"Create account":"Sign in";
  $("#auth-toggle").textContent=signup?"Already have an account? Sign in":"New here? Create an account";
  setMessage("#auth-message","");
}
$("#auth-toggle").addEventListener("click",()=>{authMode=authMode==="signin"?"signup":"signin";renderAuthMode();});
$("#auth-form").addEventListener("submit",async e=>{
  e.preventDefault(); if(!db)return;
  const email=$("#auth-email").value.trim(), password=$("#auth-password").value;
  const btn=$("#auth-submit"); btn.disabled=true; setMessage("#auth-message","One moment…");
  try{
    if(authMode==="signup"){
      const {data,error}=await db.auth.signUp({email,password,options:{data:{nickname:$("#auth-nickname").value.trim()||email.split("@")[0]}}});
      if(error)throw error;
      if(data.session){user=data.user;await loadProfile();}
      else setMessage("#auth-message","Account created. Check your email to confirm, then sign in.");
    }else{
      const {data,error}=await db.auth.signInWithPassword({email,password}); if(error)throw error; user=data.user; await loadProfile();
    }
    if(user){$("#auth-dialog").close();renderAccount();await loadChallenge();}
  }catch(err){setMessage("#auth-message",err.message||"Sign-in failed.",true);}
  finally{btn.disabled=false;}
});
async function loadProfile(){
  if(!user||!db)return;
  const {data,error}=await db.from("profiles").select("id,nickname,role").eq("id",user.id).maybeSingle();
  if(error){console.error(error);profile={id:user.id,nickname:user.user_metadata?.nickname||user.email.split("@")[0],role:"player"};}
  else profile=data;
  if(!profile){
    const nickname=user.user_metadata?.nickname||user.email.split("@")[0];
    const res=await db.from("profiles").upsert({id:user.id,nickname,role:"player"}).select().single();
    if(res.error)console.error(res.error); profile=res.data||{id:user.id,nickname,role:"player"};
  }
  isAdmin=profile?.role==="admin";
  $$(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin));
}
function renderAccount(){
  const area=$("#account-area");
  if(user){area.innerHTML='<button class="button button-outline" id="signout-btn">'+escapeHtml(profile?.nickname||user.email)+' · Sign out</button>';$("#signout-btn").onclick=async()=>{await db.auth.signOut();user=null;profile=null;isAdmin=false;renderAccount();await loadChallenge();};}
  else area.innerHTML='<button id="login-open" class="button button-outline">Sign in</button>',$("#login-open").onclick=openAuth;
}
async function boot(){
  if(!initDb()){renderSetupNeeded();return;}
  const {data}=await db.auth.getSession(); user=data.session?.user||null;
  if(user)await loadProfile();
  renderAccount(); await loadChallenge();
  db.auth.onAuthStateChange(async(_event,session)=>{
    user=session?.user||null;
    if(user) await loadProfile(); else {profile=null;isAdmin=false;}
    renderAccount(); await loadChallenge();
  });
}
function renderSetupNeeded(){
  $("#date-heading").textContent="Your daily challenge awaits";
  $("#play-status").textContent="Setup needed";
  $("#game-content").innerHTML='<div class="empty-state"><h3>Connect your game database</h3><p>Daily questions and shared scores need a Supabase database.</p><button class="button button-primary" id="setup-inline">Set up Daily Dive</button></div>';
  $("#setup-inline").onclick=()=>$("#setup-dialog").showModal();
}
async function loadChallenge(){
  $("#date-heading").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
  if(!db){renderSetupNeeded();return;}
  $("#play-status").textContent="Loading challenge";
  try{
    const {data,error}=await db.from("daily_challenges").select("id,challenge_date,title,description,status,questions(id,position,prompt,accepted_answers,base_points)").eq("challenge_date",today()).eq("status","published").maybeSingle();
    if(error)throw error;
    if(!data){questions=[];$("#play-status").textContent="No challenge yet";$("#game-content").innerHTML='<div class="empty-state"><h3>The waters are quiet.</h3><p>There is no published challenge for today yet.</p>'+(isAdmin?'<button class="button button-primary" id="make-today">Create today\'s challenge</button>':'<p>Check back later — your host has not published today\'s questions.</p>')+'</div>';if(isAdmin)$("#make-today").onclick=()=>showView("admin");return;}
    questions=(data.questions||[]).sort((a,b)=>a.position-b.position); $("#date-heading").textContent=data.title||"Today's Daily Dive";
    $("#play-status").textContent=data.status==="published"?"Challenge live":"Not live";$("#play-status").classList.add("live");
    if(user){const {data:sub,error:se}=await db.from("submissions").select("id,total_score,answers,submitted_at").eq("challenge_id",data.id).eq("user_id",user.id).maybeSingle();if(se)console.warn(se);existingSubmission=sub||null;}
    else existingSubmission=null;
    answers={}; if(existingSubmission)answers=existingSubmission.answers||{};
    currentQuestion=0;renderGame(data);
  }catch(err){console.error(err);$("#play-status").textContent="Database error";$("#game-content").innerHTML='<div class="empty-state"><h3>Could not load the challenge</h3><p>'+escapeHtml(err.message||"Check your Supabase schema and permissions.")+'</p><button class="button button-outline" id="retry">Try again</button></div>';$("#retry").onclick=loadChallenge;}
}
function renderGame(challenge){
  if(!questions.length){$("#game-content").innerHTML='<div class="empty-state"><h3>No questions added yet</h3><p>Your host can add questions in Question Studio.</p></div>';return;}
  if(existingSubmission){renderResults(existingSubmission);return;}
  if(!user){$("#game-content").innerHTML='<div class="empty-state"><h3>Ready to take the plunge?</h3><p>Sign in or create a player account to submit answers and appear on the shared leaderboard.</p><button class="button button-primary" id="join-btn">Join the dive</button></div>';$("#join-btn").onclick=openAuth;return;}
  const q=questions[currentQuestion];
  $("#game-content").innerHTML='<div class="question-card"><div class="question-top"><span class="question-number">QUESTION '+String(currentQuestion+1).padStart(2,"0")+' / '+String(questions.length).padStart(2,"0")+'</span><span class="points">UP TO '+Number(q.base_points||100)+' PTS</span></div><h3>'+escapeHtml(q.prompt)+'</h3><input id="answer-field" class="answer-input" maxlength="120" autocomplete="off" placeholder="Type your answer…" value="'+escapeHtml(answers[q.id]||"")+'"><p class="muted small">Think of a valid answer that other players might overlook. Answers are locked when you submit.</p></div><div class="game-actions"><div class="progress"><span style="width:'+((currentQuestion+1)/questions.length*100)+'%"></span></div><span class="muted small">'+Object.values(answers).filter(Boolean).length+' answered</span><button id="next-question" class="button button-primary">'+(currentQuestion===questions.length-1?"Review answers":"Next question →")+'</button></div>';
  $("#answer-field").focus();$("#answer-field").addEventListener("input",e=>answers[q.id]=e.target.value.trim());
  $("#answer-field").addEventListener("keydown",e=>{if(e.key==="Enter")$("#next-question").click();});
  $("#next-question").onclick=()=>{answers[q.id]=$("#answer-field").value.trim();if(currentQuestion<questions.length-1){currentQuestion++;renderGame(challenge);}else renderReview(challenge);};
}
function renderReview(challenge){
  const rows=questions.map((q,i)=>'<div class="result-line"><span><b>'+(i+1)+'.</b> '+escapeHtml(q.prompt)+'</span><span>'+escapeHtml(answers[q.id]||"—")+'</span></div>').join("");
  $("#game-content").innerHTML='<div class="panel"><div class="eyebrow">FINAL CHECK</div><h2>Ready to surface?</h2><p class="muted">You can submit once. Your score will be calculated after submission based on answer validity and how uncommon your answer is among other players.</p>'+rows+'<div class="game-actions"><button id="back-question" class="button button-outline">← Back</button><button id="submit-answers" class="button button-primary">Submit answers</button></div><p class="form-message" id="submit-message"></p></div>';
  $("#back-question").onclick=()=>{currentQuestion=questions.length-1;renderGame(challenge);};
  $("#submit-answers").onclick=()=>submitAnswers(challenge);
}
async function submitAnswers(challenge){
  const btn=$("#submit-answers");btn.disabled=true;setMessage("#submit-message","Submitting your dive…");
  try{
    const payload={challenge_id:challenge.id,user_id:user.id,answers,submitted_at:new Date().toISOString()};
    const {data,error}=await db.from("submissions").insert(payload).select("id,total_score,answers,submitted_at").single();
    if(error)throw error;existingSubmission=data;renderResults(data);
  }catch(err){setMessage("#submit-message",err.message||"Could not submit. Please try again.",true);btn.disabled=false;}
}
function renderResults(submission){
  const rows=questions.map((q,i)=>'<div class="result-line"><span>'+escapeHtml(q.prompt)+'<div class="player-sub">Your answer: '+escapeHtml(submission.answers?.[q.id]||"—")+'</div></span><span class="points">'+Number(q.base_points||100)+' max</span></div>').join("");
  $("#game-content").innerHTML='<div class="panel"><div class="eyebrow">DIVE COMPLETE</div><h2>Answers submitted.</h2><div class="result-total">'+(submission.total_score??"—")+'</div><p class="muted">Total points · Your score and rank are visible on the shared leaderboard.</p>'+rows+'<div class="game-actions"><button class="button button-primary" id="see-board">See leaderboard →</button></div></div>';
  $("#see-board").onclick=()=>showView("leaderboard");
}
async function loadLeaderboard(){
  const el=$("#leaderboard-content");if(!db){el.innerHTML='<div class="empty-state"><p>Connect the database to see shared scores.</p><button class="button button-primary" id="leader-setup">Database setup</button></div>';$("#leader-setup").onclick=()=>$("#setup-dialog").showModal();return;}
  el.innerHTML='<div class="empty-state"><div class="spinner"></div><p>Loading scores…</p></div>';
  try{
    const period=$("#leaderboard-period").value;
    let query=db.from("leaderboard").select("nickname,total_score,challenge_date,submitted_at").order("total_score",{ascending:false}).limit(100);
    if(period==="today")query=query.eq("challenge_date",today());
    const {data,error}=await query;if(error)throw error;
    const scores=data||[];
    if(!scores.length){el.innerHTML='<div class="empty-state"><h3>No scores on the board yet</h3><p>Be the first to complete a dive.</p></div>';return;}
    el.innerHTML='<div class="panel" style="padding:0;overflow:hidden">'+scores.map((p,i)=>'<div class="leader-row"><div class="rank '+(i<3?"top":"")+'">'+String(i+1).padStart(2,"0")+(i===0?" 🥇":i===1?" 🥈":i===2?" 🥉":"")+'</div><div><div class="player-name">'+escapeHtml(p.nickname||"Diver")+'</div><div class="player-sub">'+new Date(p.submitted_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+'</div></div><div class="score">'+Number(p.total_score||0).toLocaleString()+'</div></div>').join("")+'</div><p class="muted small">Scores refresh when you open this page. All-time view shows each player's submissions.</p>';
  }catch(err){console.error(err);el.innerHTML='<div class="empty-state"><h3>Leaderboard unavailable</h3><p>'+escapeHtml(err.message||"Check database setup.")+'</p></div>';}
}
async function renderAdmin(){
  const el=$("#admin-content");
  if(!user||!isAdmin){el.innerHTML='<div class="empty-state"><h3>Host access only</h3><p>Sign in with an account promoted to admin in Supabase.</p></div>';return;}
  const {data:challenges,error}=await db.from("daily_challenges").select("id,challenge_date,title,status,questions(id,prompt,position)").order("challenge_date",{ascending:false}).limit(14);
  if(error){el.innerHTML='<div class="empty-state"><p>'+escapeHtml(error.message)+'</p></div>';return;}
  el.innerHTML='<div class="panel"><div class="eyebrow">NEW CHALLENGE</div><form id="challenge-form" class="stack"><label>Date<input type="date" id="challenge-date" required value="'+today()+'"></label><label>Challenge title<input id="challenge-title" maxlength="90" required placeholder="The Monday Mind-Bender"></label><label>Description<textarea id="challenge-description" placeholder="A short intro for players (optional)"></textarea></label><div id="question-builder"></div><button type="button" class="button secondary" id="add-question">＋ Add question</button><div class="admin-actions"><button class="button button-outline" type="submit" data-publish="false">Save draft</button><button class="button button-primary" type="submit" data-publish="true">Publish challenge</button></div><p class="form-message" id="admin-message"></p></form></div><h3>Recent challenges</h3><div id="challenge-list">'+(challenges||[]).map(c=>'<div class="question-admin"><div class="question-top"><b>'+escapeHtml(c.title)+'</b><span class="status-pill">'+escapeHtml(c.status)+'</span></div><p class="muted">'+escapeHtml(c.challenge_date)+' · '+(c.questions||[]).length+' questions</p></div>').join("")+'</div>';
  let qCount=0;const addQuestion=(prompt="",accepted="",points=100)=>{qCount++;const id=qCount;const wrap=document.createElement("div");wrap.className="question-admin";wrap.dataset.qid=id;wrap.innerHTML='<div class="question-top"><span class="question-number">QUESTION '+String(id).padStart(2,"0")+'</span><button class="text-button remove-question" type="button">Remove</button></div><div class="stack"><label>Question prompt<textarea class="q-prompt" required placeholder="Name something…">'+escapeHtml(prompt)+'</textarea></label><label>Accepted answers <textarea class="q-accepted" required placeholder="Answer one, answer two, another valid answer">'+escapeHtml(accepted)+'</textarea><span class="muted small">Comma-separated. Answers are matched case-insensitively.</span></label><label>Maximum points<input class="q-points" type="number" min="1" max="1000" value="'+points+'"></label></div>';wrap.querySelector(".remove-question").onclick=()=>wrap.remove();$("#question-builder").appendChild(wrap);};
  addQuestion();addQuestion();
  $("#add-question").onclick=()=>addQuestion();
  $("#challenge-form").addEventListener("submit",async e=>{
    e.preventDefault();const publish=e.submitter?.dataset.publish==="true";const btn=e.submitter;btn.disabled=true;setMessage("#admin-message","Saving challenge…");
    try{
      const entries=$$("#question-builder .question-admin").map((w,i)=>({position:i+1,prompt:w.querySelector(".q-prompt").value.trim(),accepted_answers:w.querySelector(".q-accepted").value.split(",").map(x=>x.trim()).filter(Boolean),base_points:Number(w.querySelector(".q-points").value)||100})).filter(q=>q.prompt);
      if(!entries.length)throw new Error("Add at least one question.");
      if(publish&&entries.some(q=>!q.accepted_answers.length))throw new Error("Every published question needs accepted answers.");
      const date=$("#challenge-date").value;
      const {data:challenge,error:ce}=await db.from("daily_challenges").upsert({challenge_date:date,title:$("#challenge-title").value.trim(),description:$("#challenge-description").value.trim(),status:"draft",created_by:user.id},{onConflict:"challenge_date"}).select("id").single();
      if(ce)throw ce;
      const del=await db.from("questions").delete().eq("challenge_id",challenge.id);if(del.error)throw del.error;
      const qrows=entries.map(q=>({...q,challenge_id:challenge.id}));
      const ins=await db.from("questions").insert(qrows);if(ins.error)throw ins.error;
      if(publish){const upd=await db.from("daily_challenges").update({status:"published"}).eq("id",challenge.id);if(upd.error)throw upd.error;}
      setMessage("#admin-message",publish?"Challenge published! Players can now take today's dive.":"Draft saved.");
      await loadChallenge();await renderAdmin();
    }catch(err){setMessage("#admin-message",err.message||"Could not save challenge.",true);}
    finally{btn.disabled=false;}
  });
}
async function start(){
  initDb();
  $("#date-heading").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
  if(db)await boot();else renderSetupNeeded();
}
start();
