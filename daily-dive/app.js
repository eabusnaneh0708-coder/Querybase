/* Daily Dive: anonymous daily players, shared leaderboard, host-only question studio.
 * Set SUPABASE_URL and SUPABASE_ANON_KEY before publishing.
 * Never put a Supabase service-role key in this browser file.
 */
const SUPABASE_URL = "https://czpzmreqvmoarzuyvxkn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_capEYCXpQ__g6lj2JJOacg_2SweKbpr";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
let db=null, host=null, hostProfile=null, questions=[], answers={}, currentQuestion=0, existingSubmission=null, isAdmin=false, currentChallenge=null, boardTimer=null;
let attemptDeadline=null, countdownInterval=null, timerExpired=false, isSubmitting=false;

function initDb(){
  const url=localStorage.getItem("dd_supabase_url")||SUPABASE_URL;
  const key=localStorage.getItem("dd_supabase_key")||SUPABASE_ANON_KEY;
  if(!url||!key||!window.supabase){db=null;return false;}
  db=window.supabase.createClient(url,key);return true;
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setMessage(selector,msg,error=false){const el=$(selector);if(!el)return;el.textContent=msg;el.classList.toggle("error",error);}
function guestForToday(){
  const key="dd_guest_player";let guest;
  try{guest=JSON.parse(localStorage.getItem(key)||"null");}catch{}
  if(!guest||!guest.id){
    guest={id:crypto.randomUUID(),nickname:""};
    localStorage.setItem(key,JSON.stringify(guest));
  }
  return guest;
}

function showView(name){
  $$(".view").forEach(v=>v.classList.add("hidden"));
  $("#view-"+name).classList.remove("hidden");
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="leaderboard")loadLeaderboard();
  if(name==="admin")renderAdmin();
}
$$(".nav-link").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$("#host-login-open").addEventListener("click",()=>openHostLogin());
$("#setup-open").addEventListener("click",()=>$("#setup-dialog").showModal());
$("#leaderboard-period").addEventListener("change",loadLeaderboard);

$("#config-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const url=$("#config-url").value.trim().replace(/\/$/,""),key=$("#config-key").value.trim();
  localStorage.setItem("dd_supabase_url",url);localStorage.setItem("dd_supabase_key",key);
  if(!initDb()){setMessage("#config-message","Could not initialize Supabase. Check the URL and publishable/anon key.",true);return;}
  setMessage("#config-message","Connected. Loading today's challenge…");
  await boot();setTimeout(()=>$("#setup-dialog").close(),700);
});

function openHostLogin(){
  if(!db){$("#setup-dialog").showModal();return;}
  $("#host-auth-email").value="";$("#host-auth-password").value="";
  setMessage("#host-auth-message","");
  $("#host-auth-dialog").showModal();
}
$("#host-auth-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!db)return;
  const btn=$("#host-auth-submit");btn.disabled=true;setMessage("#host-auth-message","Signing in…");
  try{
    const {data,error}=await db.auth.signInWithPassword({email:$("#host-auth-email").value.trim(),password:$("#host-auth-password").value});
    if(error)throw error;
    host=data.user;await loadHostProfile();
    if(!isAdmin){await db.auth.signOut();host=null;hostProfile=null;throw new Error("This account is not a Daily Dive host yet.");}
    $("#host-auth-dialog").close();renderHostArea();await loadChallenge();showView("admin");
  }catch(err){setMessage("#host-auth-message",err.message||"Host sign-in failed.",true);}
  finally{btn.disabled=false;}
});
async function loadHostProfile(){
  isAdmin=false;hostProfile=null;
  if(!host||!db)return;
  const {data,error}=await db.from("profiles").select("id,nickname,role").eq("id",host.id).maybeSingle();
  if(error)throw error;hostProfile=data;isAdmin=data?.role==="admin";
  $$(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin));
}
function renderHostArea(){
  const area=$("#account-area");
  if(host&&isAdmin){
    area.innerHTML='<button class="button button-outline" id="host-signout">Host sign out</button>';
    $("#host-signout").onclick=async()=>{await db.auth.signOut();host=null;hostProfile=null;isAdmin=false;$$(".admin-only").forEach(el=>el.classList.add("hidden"));renderHostArea();showView("play");await loadChallenge();};
  }else{
    area.innerHTML='<button class="button button-outline" id="host-login-open">Host login</button>';
    $("#host-login-open").onclick=openHostLogin;
  }
}
async function boot(){
  if(!initDb()){renderSetupNeeded();return;}
  const {data,error}=await db.auth.getSession();
  if(error)console.warn(error);
  host=data.session?.user||null;
  if(host){try{await loadHostProfile();}catch(e){console.warn(e);host=null;isAdmin=false;}}
  renderHostArea();await loadChallenge();
  if(boardTimer)clearInterval(boardTimer);
  boardTimer=setInterval(()=>{if(!$("#view-leaderboard").classList.contains("hidden"))loadLeaderboard();},10000);
  db.auth.onAuthStateChange(async(_event,session)=>{
    host=session?.user||null;
    try{if(host)await loadHostProfile();else{hostProfile=null;isAdmin=false;}}catch(e){console.warn(e);isAdmin=false;}
    renderHostArea();await loadChallenge();
  });
}
function renderSetupNeeded(){
  $("#date-heading").textContent="Your daily challenge awaits";$("#play-status").textContent="Setup needed";
  $("#game-content").innerHTML='<div class="empty-state"><h3>One quick setup step</h3><p>The game needs its shared database before everyone can play.</p><button class="button button-primary" id="setup-inline">Connect Daily Dive</button></div>';
  $("#setup-inline").onclick=()=>$("#setup-dialog").showModal();
}
async function loadChallenge(){
  $("#date-heading").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",timeZone:"America/New_York"});
  if(!db){renderSetupNeeded();return;}
  $("#play-status").textContent="Loading challenge";$("#play-status").classList.remove("live");
  try{
    const {data,error}=await db.rpc("get_daily_challenge");if(error)throw error;
    if(!data){
      currentChallenge=null;questions=[];existingSubmission=null;$("#play-status").textContent="Not published";
      $("#game-content").innerHTML='<div class="empty-state"><h3>The waters are quiet.</h3><p>There is no published challenge for today yet.</p>'+(isAdmin?'<button class="button button-primary" id="make-today">Create today\'s challenge</button>':'<p>Check back later for today\'s questions.</p>')+'</div>';
      if(isAdmin)$("#make-today").onclick=()=>showView("admin");return;
    }
    currentChallenge=data;questions=(data.questions||[]).sort((a,b)=>a.position-b.position);
    $("#date-heading").textContent=data.title||"Today's Daily Dive";$("#play-status").textContent="Challenge live";$("#play-status").classList.add("live");
    const guest=guestForToday();
    const {data:sub,error:se}=await db.rpc("get_my_daily_submission",{p_guest_id:guest.id});
    if(se)console.warn(se);
    existingSubmission=sub||null;
    if(existingSubmission?.nickname && !guest.nickname){guest.nickname=existingSubmission.nickname;localStorage.setItem("dd_guest_player",JSON.stringify(guest));}
    answers=existingSubmission?.answers||{};currentQuestion=0;
    if(existingSubmission){
      if(countdownInterval)clearInterval(countdownInterval);
      countdownInterval=null;attemptDeadline=null;
      $("#countdown-timer")?.classList.add("hidden");
      renderResults(existingSubmission);
    }else if(!guest.nickname){
      $("#countdown-timer")?.classList.add("hidden");
      renderNameSetup(data);
    }else{
      const draftKey=draftStorageKey(data.id,guest.id);
      try{answers={...answers,...JSON.parse(localStorage.getItem(draftKey)||"{}")};}catch{}
      const attempt=await startChallengeAttempt(data,guest);
      startCountdown(attempt.deadline_at,data,guest);
      renderGame(data);
    }
  }catch(err){
    console.error(err);$("#play-status").textContent="Database error";
    $("#game-content").innerHTML='<div class="empty-state"><h3>Could not load today\'s challenge</h3><p>'+escapeHtml(err.message||"Check the database setup.")+'</p><button class="button button-outline" id="retry">Try again</button></div>';
    $("#retry").onclick=loadChallenge;
  }
}
function renderNameSetup(challenge){
  $( "#game-content" ).innerHTML='<div class="panel"><div class="eyebrow">YOUR PLAYER NAME</div><h2>Choose your name</h2><p class="muted">Your name appears beside your score on the Emillions leaderboard. You only need to choose it once on this browser.</p><form id="player-name-form" class="stack"><label>Display name<input id="player-name-input" minlength="2" maxlength="20" required pattern="[A-Za-z0-9 _-]{2,20}" autocomplete="nickname" placeholder="e.g. RetroTech99"></label><p class="muted small">2–20 letters, numbers, spaces, dashes or underscores. Names must be unique.</p><button class="button button-primary" id="save-player-name" type="submit">Save name and play</button><p class="form-message" id="player-name-message"></p></form></div>';
  $("#player-name-form").addEventListener("submit",async e=>{
    e.preventDefault();const btn=$("#save-player-name");btn.disabled=true;setMessage("#player-name-message","Checking name…");
    try{
      const nickname=$("#player-name-input").value.trim();
      const guest=guestForToday();
      const {data,error}=await db.functions.invoke("emillions-api",{body:{action:"register",guest_id:guest.id,nickname}});
      if(error)throw error;
      if(data?.error)throw new Error(data.error);
      guest.nickname=data.nickname;localStorage.setItem("dd_guest_player",JSON.stringify(guest));
      await loadChallenge();
    }catch(err){setMessage("#player-name-message",err.message||"Could not save that name.",true);btn.disabled=false;}
  });
}
function draftStorageKey(challengeId,guestId){return "dd_answers_"+challengeId+"_"+guestId;}
function saveDraftAnswers(){
  const guest=guestForToday();
  if(currentChallenge?.id&&guest?.id){
    try{localStorage.setItem(draftStorageKey(currentChallenge.id,guest.id),JSON.stringify(answers));}catch{}
  }
}
function saveCurrentAnswer(){
  const field=$("#answer-field");
  if(field&&questions[currentQuestion])answers[questions[currentQuestion].id]=field.value.trim();
  saveDraftAnswers();
}
async function startChallengeAttempt(challenge,guest){
  const {data,error}=await db.functions.invoke("emillions-api",{body:{action:"start",guest_id:guest.id}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  if(data?.already_submitted)throw new Error("You've already submitted today's dive.");
  return data;
}
function startCountdown(deadline,challenge,guest){
  if(countdownInterval)clearInterval(countdownInterval);
  attemptDeadline=new Date(deadline).getTime();
  timerExpired=false;
  const timer=$("#countdown-timer");
  timer.classList.remove("hidden");
  const tick=()=>{
    const remaining=Math.max(0,attemptDeadline-Date.now());
    const seconds=Math.ceil(remaining/1000);
    timer.textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
    timer.classList.toggle("timer-warning",seconds<=30);
    if(remaining<=0&&!timerExpired){
      timerExpired=true;
      if(countdownInterval)clearInterval(countdownInterval);
      countdownInterval=null;
      saveCurrentAnswer();
      timer.textContent="Submitting…";
      submitAnswers(challenge,true);
    }
  };
  tick();
  countdownInterval=setInterval(tick,250);
}
function renderGame(challenge){
  if(!questions.length){$("#game-content").innerHTML='<div class="empty-state"><h3>No questions added yet</h3><p>The host will add questions in Question Studio.</p></div>';return;}
  if(existingSubmission){renderResults(existingSubmission);return;}
  const q=questions[currentQuestion];
  $("#game-content").innerHTML='<div class="question-card"><div class="question-top"><span class="question-number">QUESTION '+String(currentQuestion+1).padStart(2,"0")+' / '+String(questions.length).padStart(2,"0")+'</span><span class="points">UP TO '+Number(q.base_points||100)+' PTS</span></div><h3>'+escapeHtml(q.prompt)+'</h3><input id="answer-field" class="answer-input" maxlength="120" autocomplete="off" placeholder="Type your answer…" value="'+escapeHtml(answers[q.id]||"")+'"><p class="muted small">Try to think of a good answer others might overlook. Your answers lock when you submit.</p></div><div class="game-actions"><div class="progress"><span style="width:'+((currentQuestion+1)/questions.length*100)+'%"></span></div><span class="muted small">'+Object.values(answers).filter(Boolean).length+' answered</span><button id="next-question" class="button button-primary">'+(currentQuestion===questions.length-1?"Review answers":"Next question →")+'</button></div>';
  $("#answer-field").focus();$("#answer-field").addEventListener("input",e=>{answers[q.id]=e.target.value.trim();saveDraftAnswers();});
  $("#answer-field").addEventListener("keydown",e=>{if(e.key==="Enter")$("#next-question").click();});
  $("#next-question").onclick=()=>{saveCurrentAnswer();if(currentQuestion<questions.length-1){currentQuestion++;renderGame(challenge);}else renderReview(challenge);};
}
function renderReview(challenge){
  const rows=questions.map((q,i)=>'<div class="result-line"><span><b>'+(i+1)+'.</b> '+escapeHtml(q.prompt)+'</span><span>'+escapeHtml(answers[q.id]||"—")+'</span></div>').join("");
  $("#game-content").innerHTML='<div class="panel"><div class="eyebrow">FINAL CHECK</div><h2>Ready to surface?</h2><p class="muted">You can submit once today. The game checks answers and calculates points securely in the database.</p>'+rows+'<div class="game-actions"><button id="back-question" class="button button-outline">← Back</button><button id="submit-answers" class="button button-primary">Submit answers</button></div><p class="form-message" id="submit-message"></p></div>';
  $("#back-question").onclick=()=>{saveCurrentAnswer();currentQuestion=questions.length-1;renderGame(challenge);};
  $("#submit-answers").onclick=()=>submitAnswers(challenge,false);
}
async function submitAnswers(challenge,automatic=false){
  if(isSubmitting||existingSubmission)return;
  isSubmitting=true;
  saveCurrentAnswer();
  const btn=$("#submit-answers");
  if(btn)btn.disabled=true;
  if(!automatic)setMessage("#submit-message","Checking answers and calculating rarity…");
  try{
    const guest=guestForToday();
    const {data,error}=await db.functions.invoke("emillions-api",{body:{action:"submit",guest_id:guest.id,answers}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    existingSubmission=data;
    if(countdownInterval)clearInterval(countdownInterval);
    countdownInterval=null;attemptDeadline=null;
    try{localStorage.removeItem(draftStorageKey(currentChallenge?.id,guest.id));}catch{}
    $("#countdown-timer")?.classList.add("hidden");
    renderResults(data);loadLeaderboard();
  }catch(err){
    if(automatic){
      renderReview(challenge);
      setMessage("#submit-message","Time expired, but automatic submission failed: "+(err.message||"Please submit again now."),true);
      const timer=$("#countdown-timer");
      timer.classList.remove("hidden");timer.textContent="Time expired";timer.classList.add("timer-warning");
    }else{
      setMessage("#submit-message",err.message||"Could not submit. Please try again.",true);
    }
    if(btn)btn.disabled=false;
  }finally{isSubmitting=false;}
}

function rankForScore(score){
  if(score>=600)return "Legendary";
  if(score>=500)return "Super Rare";
  if(score>=385)return "Epic Hunter";
  if(score>=245)return "Rare Hunter";
  if(score>=140)return "Explorer";
  return "Daily Diver";
}
function renderResults(submission){
  if(countdownInterval)clearInterval(countdownInterval);
  countdownInterval=null;attemptDeadline=null;
  $("#countdown-timer")?.classList.add("hidden");
  const resultMap=submission.results||{};
  const rows=questions.map(q=>{
    const r=resultMap[q.id]||{};
    const answer=submission.answers?.[q.id]||"—";
    const status=r.valid ? '<span class="tag">'+escapeHtml(r.tier||"Scored")+' · '+Number(r.points||0)+' pts</span>' : '<span class="tag">0 pts · '+escapeHtml(r.tier||"Not accepted")+'</span>';
    return '<div class="result-line"><span>'+escapeHtml(q.prompt)+'<div class="player-sub">Your answer: '+escapeHtml(answer)+'</div>'+status+'</span><span class="points">'+Number(r.points||0)+' pts</span></div>';
  }).join("");
  const rank= submission.rank_name || rankForScore(Number(submission.total_score||0));
  $( "#game-content" ).innerHTML='<div class="panel"><div class="eyebrow">DIVE COMPLETE</div><h2>'+escapeHtml(submission.nickname||guestForToday().nickname||"Player")+', your dive is complete.</h2><div class="result-total">'+Number(submission.total_score||0).toLocaleString()+'</div><h3>'+escapeHtml(rank)+'</h3><p class="muted">Final score · Out of 700 possible points. Your score and rank are saved.</p>'+rows+'<div class="game-actions"><button class="button button-primary" id="see-board">See leaderboard →</button></div></div>';
  $("#see-board").onclick=()=>showView("leaderboard");
}

async function loadLeaderboard(){
  const el=$("#leaderboard-content");if(!db){el.innerHTML='<div class="empty-state"><p>Connect the database to see shared scores.</p><button class="button button-primary" id="leader-setup">Database setup</button></div>';$("#leader-setup").onclick=()=>$("#setup-dialog").showModal();return;}
  el.innerHTML='<div class="empty-state"><div class="spinner"></div><p>Loading scores…</p></div>';
  try{
    const period=$("#leaderboard-period").value;
    const {data,error}=await db.rpc("get_daily_leaderboard",{p_challenge_date:period==="today"?today():null});
    if(error)throw error;const scores=data||[];
    if(!scores.length){el.innerHTML='<div class="empty-state"><h3>No scores on the board yet</h3><p>Be the first to complete today\'s dive.</p></div>';return;}
    el.innerHTML='<div class="panel" style="padding:0;overflow:hidden">'+scores.map((p,i)=>'<div class="leader-row"><div class="rank '+(i<3?"top":"")+'">'+String(i+1).padStart(2,"0")+(i===0?" 🥇":i===1?" 🥈":i===2?" 🥉":"")+'</div><div><div class="player-name">'+escapeHtml(p.nickname||"Diver")+'</div><div class="player-sub">'+new Date(p.submitted_at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+'</div></div><div class="score">'+Number(p.total_score||0).toLocaleString()+'</div></div>').join("")+'</div><p class="muted small">The leaderboard refreshes automatically every 10 seconds. Guest IDs reset each day on this browser.</p>';
  }catch(err){console.error(err);el.innerHTML='<div class="empty-state"><h3>Leaderboard unavailable</h3><p>'+escapeHtml(err.message||"Check database setup.")+'</p></div>';}
}
async function renderAdmin(){
  const el=$("#admin-content");
  if(!host||!isAdmin){el.innerHTML='<div class="empty-state"><h3>Host access only</h3><p>Use Host login with your trusted host account to manage questions.</p><button class="button button-primary" id="admin-login-button">Host login</button></div>';$("#admin-login-button").onclick=openHostLogin;return;}
  const {data:challenges,error}=await db.from("daily_challenges").select("id,challenge_date,title,status,questions(id,prompt,position)").order("challenge_date",{ascending:false}).limit(14);
  if(error){el.innerHTML='<div class="empty-state"><p>'+escapeHtml(error.message)+'</p></div>';return;}
  el.innerHTML='<div class="panel"><div class="eyebrow">NEW CHALLENGE</div><p class="muted">Build today\'s challenge from the built-in question bank. It selects 2 easy, 2 medium, 2 hard and 1 expert question, then shuffles the order for everyone. No paid AI service is used.</p><button type="button" class="button button-primary" id="generate-bank-challenge">Load today\'s 7 from question bank</button><p class="form-message" id="bank-generate-message"></p><form id="challenge-form" class="stack"><label>Date (Eastern time)<input type="date" id="challenge-date" required value="'+today()+'"></label><label>Challenge title<input id="challenge-title" maxlength="90" required placeholder="The Daily Mind-Bender"></label><label>Description<textarea id="challenge-description" placeholder="A short intro (optional)"></textarea></label><div id="question-builder"></div><button type="button" class="button secondary" id="add-question">＋ Add question</button><div class="admin-actions"><button class="button button-outline" type="submit" data-publish="false">Save draft</button><button class="button button-primary" type="submit" data-publish="true">Publish challenge</button></div><p class="form-message" id="admin-message"></p></form></div><h3>Recent challenges</h3><div id="challenge-list">'+(challenges||[]).map(c=>'<div class="question-admin"><div class="question-top"><b>'+escapeHtml(c.title)+'</b><span class="status-pill">'+escapeHtml(c.status)+'</span></div><p class="muted">'+escapeHtml(c.challenge_date)+' · '+(c.questions||[]).length+' questions</p></div>').join("")+'</div>';
  $("#generate-bank-challenge").onclick=async()=>{
    const btn=$("#generate-bank-challenge");btn.disabled=true;setMessage("#bank-generate-message","Building today's challenge from the question bank…");
    try{
      const {data,error}=await db.functions.invoke("emillions-api",{body:{action:"generate"}});
      if(error)throw error;if(data?.error)throw new Error(data.error);
      setMessage("#bank-generate-message",data.message||"Today's challenge is ready.");
      await loadChallenge();await renderAdmin();
    }catch(err){setMessage("#bank-generate-message",err.message||"Could not build the challenge. Check the Edge Function deployment.",true);}
    finally{const again=$("#generate-bank-challenge");if(again)again.disabled=false;}
  };
  let qCount=0;
  const addQuestion=(prompt="",accepted="",points=100)=>{qCount++;const id=qCount;const wrap=document.createElement("div");wrap.className="question-admin";wrap.dataset.qid=id;wrap.innerHTML='<div class="question-top"><span class="question-number">QUESTION '+String(id).padStart(2,"0")+'</span><button class="text-button remove-question" type="button">Remove</button></div><div class="stack"><label>Question prompt<textarea class="q-prompt" required placeholder="Name something…">'+escapeHtml(prompt)+'</textarea></label><label>Accepted answers<textarea class="q-accepted" required placeholder="Answer one, answer two, another valid answer">'+escapeHtml(accepted)+'</textarea><span class="muted small">Comma-separated. Matching ignores capitalization.</span></label><label>Maximum points<input class="q-points" type="number" min="1" max="1000" value="'+points+'"></label></div>';wrap.querySelector(".remove-question").onclick=()=>wrap.remove();$("#question-builder").appendChild(wrap);};
  addQuestion();addQuestion();$("#add-question").onclick=()=>addQuestion();
  $("#challenge-form").addEventListener("submit",async e=>{
    e.preventDefault();const publish=e.submitter?.dataset.publish==="true";const btn=e.submitter;btn.disabled=true;setMessage("#admin-message","Saving challenge…");
    try{
      const entries=$$("#question-builder .question-admin").map((w,i)=>({position:i+1,prompt:w.querySelector(".q-prompt").value.trim(),accepted_answers:w.querySelector(".q-accepted").value.split(",").map(x=>x.trim()).filter(Boolean),base_points:Number(w.querySelector(".q-points").value)||100})).filter(q=>q.prompt);
      if(!entries.length)throw new Error("Add at least one question.");
      if(publish&&entries.some(q=>!q.accepted_answers.length))throw new Error("Every published question needs accepted answers.");
      const date=$("#challenge-date").value;
      const {data:challenge,error:ce}=await db.from("daily_challenges").upsert({challenge_date:date,title:$("#challenge-title").value.trim(),description:$("#challenge-description").value.trim(),status:"draft",created_by:host.id},{onConflict:"challenge_date"}).select("id").single();
      if(ce)throw ce;
      const del=await db.from("questions").delete().eq("challenge_id",challenge.id);if(del.error)throw del.error;
      const ins=await db.from("questions").insert(entries.map(q=>({...q,challenge_id:challenge.id})));if(ins.error)throw ins.error;
      if(publish){const upd=await db.from("daily_challenges").update({status:"published"}).eq("id",challenge.id);if(upd.error)throw upd.error;}
      setMessage("#admin-message",publish?"Challenge published! Players can play now.":"Draft saved.");
      await loadChallenge();await renderAdmin();
    }catch(err){setMessage("#admin-message",err.message||"Could not save challenge.",true);}
    finally{btn.disabled=false;}
  });
}
async function start(){initDb();$("#date-heading").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",timeZone:"America/New_York"});if(db)await boot();else renderSetupNeeded();}
start();
