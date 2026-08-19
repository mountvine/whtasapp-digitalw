/*!
 * DIGITALAW — After-Deal Shared Logic Engine (pure functions, no DOM, no globals besides Date/Math/String/JSON)
 * SOURCE OF TRUTH for Module 3 ("אחרי עסקה") business logic.
 * Consumed by BOTH:
 *   1. The web portal (system1_v96_34.html, module #mod-after) — its UI wrapper functions call into this
 *      engine and then render the DOM/UI from the returned data.
 *   2. The WhatsApp/Zapier automation flow (Code by Zapier steps) — fetches this file at runtime and calls
 *      the same functions directly, so both surfaces always run byte-identical logic.
 *
 * RULE: any bug fix or logic change to the after-deal flow MUST be made HERE FIRST (not by re-editing a
 * pasted copy inside the HTML file or inside a Zapier Code step). After changing this file, the web
 * portal's wrapper functions and the hosted copy Zapier fetches pick up the fix automatically on next load.
 * See claude/AFTER_DEAL_LOGIC_CALIBRATION_v1.md and claude/ZAPIER_AFTER_SIGNATURE_ENGAGEMENT_NOTES.md.
 *
 * Extracted + refactored from system1_v96_34.html (Module 3, "runValidation"/"buildQuestions"/
 * "m3BuildMilestones"/"buildICS" and their helper functions) on 2026-08-19. The only changes made during
 * extraction: (a) removed all direct DOM access (byId/innerHTML/appendChild) and all references to the
 * module-level browser state object — every function now takes explicit parameters and returns plain data;
 * (b) renamed the 4 entry points with a "Core" suffix; (c) fixed one latent bug exposed by the refactor —
 * a duplicate `crossTatFlags` reset later in buildMilestonesCore was harmless as a mutable property
 * assignment but would throw against the new immutable local binding, so it was changed to
 * `crossTatFlags.length=0` (same runtime effect: clears the array in place). No other logic was altered.
 */
(function(root, factory){
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.AfterDealEngine = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  // ── generic date/number helpers ──
  function pad(n){return String(n).padStart(2,'0');}
  function isoToDisplay(iso){ if(!iso)return''; const p=iso.split('-'); return p[2]+'.'+p[1]+'.'+p[0]; }
  function addDays(iso,days){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
  function addMonths(iso,m){ const d=new Date(iso+'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth()+m); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
  // Hebrew: ל + ה... → ל... (collapse the article)
  function le(word){ word=String(word||'').trim(); if(!word)return''; return 'ל'+(word[0]==='ה'?word.slice(1):word); }
  function parseNum(s){ const str=String(s||''); const m=str.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/); if(!m)return 0; const v=parseFloat(m[0].replace(/,/g,'')); return isNaN(v)?0:v; }

  // ── extraction prompts (Claude system prompts) — identical to the ones the web portal sends today ──
  const NASACH_SYS = `אתה מערכת מדויקת לחילוץ נתונים מנסח טאבו ישראלי (נסח רישום מקרקעין). החזר אך ורק אובייקט JSON תקין יחיד, ללא טקסט מקדים וללא code fence.
מבנה הפלט:
{"is_nasach":true/false,"gush":"מספר","helka":"מספר","tat_helka":"מספר או null","area_sqm":מספר או null,"floor":"קומה או null","address":"כתובת או null","lishka":"שם הלשכה או null","nasach_date":"DD/MM/YYYY או null","owners":[{"name":"שם","id":"ת.ז/ח.פ","id_type":"ת.ז/חברה","share":"החלק כמו 1/2"}],"warnings":[{"type":"משכנתה/עיקול/תקנה 27/תקנה 29/הערת אזהרה/צו הריסה/הערה אחרת","detail":"תיאור","in_favor_of":"לטובת מי או null","on_owner":"על איזה בעלים או null","shtar":"מספר שטר או null"}]}
כללים: 1) חלץ את כל הבעלים עם החלקים. 2) ⚠️ סווג כל הערה לפי הסוג — הבחן בין משכנתה (לבנק), עיקול, תקנה 27, תקנה 29, הערת אזהרה, והערה אחרת. 3) אל תמציא — שדה חסר=null. עברית.`;
  const AGR_SYS = `אתה עוזר משפטי ישראלי המחלץ נתונים מהסכם מכר מקרקעין (יד 2, דירה בבית משותף, בין צדדים פרטיים). החזר אך ורק אובייקט JSON תקין יחיד, ללא טקסט מקדים וללא code fence.
מבנה הפלט:
{"meta":{"title":"תקציר הסכם מכר — כתובת","kind":"הסכם מכר דירת מגורים (יד 2)","sign_date":"DD.MM.YYYY או null","sign_date_iso":"YYYY-MM-DD או null","sellers":[{"name":"שם","id":"ת.ז","share":"חלק או null"}],"buyers":[{"name":"שם","id":"ת.ז"}],"property":{"gush":"","helka":"","tat_helka":"","area_sqm":null,"floor":"","address":"","rooms":""},"price":"סכום ₪","trustee":"שם הנאמן","reps":"ייצוג"},"payments":[{"number":1,"amount":"₪","when":"מועד","payee":"מקבל","held_in_trust":true/false,"is_down_payment":true/false,"cond":"תנאי","iso":"YYYY-MM-DD או ריק"}],"conditions":[{"kind":"מתלה/מפסיק","text":"תיאור התנאי","original_deadline":"DD.MM.YYYY או null","original_deadline_iso":"YYYY-MM-DD או null","extension_allowed":true/false,"extension_text":"תיאור הארכה או null","responsible":"מוכר/קונה/שניהם"}],"seller_mortgage":{"exists":true/false,"bank":"בנק או null","balance":"יתרה או null","payoff_deadline":"DD.MM.YYYY או null","payoff_deadline_iso":"YYYY-MM-DD או null","payoff_text":"כפי שמופיע","deletion_days":מספר הימים שהמוכר מתחייב למחוק/להסיר את המשכנתה לאחר הסילוק או null},"trustee_amount":{"exists":true/false,"amount":"סכום כולל או null","amount_shevach":"סכום לאישור מס שבח או null","amount_iriya":"סכום לאישור עירייה כולל היטל השבחה או null","released_against":"כנגד אילו אישורים","deadline":"מועד או null","deadline_iso":"YYYY-MM-DD או null"},"delivery":{"date":"DD.MM.YYYY או null","date_iso":"YYYY-MM-DD או null","text":"תנאי המסירה"},"handover_documents":["רשימת המסמכים שהמוכר/ב\"כ המוכר מעביר לקונה/ב\"כ הקונה במסירה כנגד התשלום האחרון — כפי שמופיעים בהסכם (כגון ייפוי כוח בלתי חוזר, שטר מכר חתום, אישור מס שבח, אישור עירייה, נסח/דו\"ח עיון נקי, אישורי מסים)"],"urban_renewal":{"mentioned":true/false,"type":"פינוי-בינוי/תמא 38-1/תמא 38-2/null","developers":["שם יזם"],"signed":"כן/לא ברור","sign_project_docs_days":מספר ימים לחתימת מסמכי הפרויקט או null},"seller_pledge_required":true/false (האם ההסכם דורש במפורש רישום משכון על שם המוכר — בעסקאות חברה משכנת),"breach":{"breach_days":"מספר ימים לתיקון הפרה או null","fundamental_breach_days":"מספר ימים להפרה יסודית או null","breach_text":"נוסח סעיף ההפרה כפי שמופיע או null"},"tax_notes":["מי משלם מס שבח/רכישה/היטל"],"summary":["פסקאות תמצית (מותר <b>)"],"flags":["דגשים"]}
כללים: 1) חלץ כל הצדדים עם ת.ז. 2) חלץ את כל לוח התשלומים — אל תשמיט תשלום; מועד ריק→when:"לא נקבע". לכל תשלום סמן held_in_trust ו-is_down_payment. 3) ⚠️ תנאי מתלה (kind:"מתלה") הוא תנאי בינארי (1/0) המופיע בד"כ בתחילת ההסכם — אם מתקיים יש עסקה, אם לא תוך התקופה החוזה מתבטל. ⚠️ סווג כ-kind:"מפסיק" אך ורק אם ההסכם קובע במפורש שהחוזה יחדל/יתבטל בהתרחש אירוע עתידי (נדיר ביותר). ⚠️ אל תסווג תשלום, מסירה, רישום הערת אזהרה, סילוק משכנתה או כל חיוב מעשי רגיל כ-condition. אם בספק — אל תכלול. חלץ original_deadline ו-extension_allowed. 4) משכנתת מוכר: אם מוזכרת לסילוק — חלץ בנק/יתרה/מועד; אחרת exists:false. 5) סכום נאמנות: סכום כולל + פירוק (amount_shevach, amount_iriya) + מועד. 6) ⚠️ ימי הפרה: חלץ את מספר הימים לתיקון הפרה ולהפרה יסודית אם מופיעים בהסכם. 7) ⚠️ התחדשות עירונית: אם ההסכם מזכיר הסכם התחדשות עירונית / פינוי-בינוי / תמ"א 38 / יזם — סמן mentioned:true, חלץ את שם/שמות היזם/ים ואת מספר הימים לחתימת מסמכי הפרויקט (ברירת מחדל 7 אם לא צוין). 8) אל תמציא — שדה חסר=null/ריק. עברית. 9) ⚠️ payments, conditions, seller_mortgage חובה במדויק; ודא JSON תקין.`;
  const PRECHECK_SYS = `חלץ מהסכם מכר מקרקעין אך ורק את פרטי הזיהוי. החזר JSON יחיד בלבד, ללא טקסט נוסף:
{"gush":"","helka":"","tat_helka":"","sellers":[{"name":"שם מלא","id":"ת.ז"}]}
חלץ רק גוש, חלקה, תת-חלקה, ושמות+ת.ז של המוכרים. אל תחלץ תשלומים/תנאים/תמורה/מסירה. עברית.`;

  // ── nasach-analysis helpers, bound to a (nasach, agreement) context ──
  function makeCtx(nasach, agreement){
  // זיהוי הערות-יזם בנסח (הערת אזהרה לטובת גורם שאינו בנק ואינו הקונה)
  function developerNotes(){
    const n=nasach; if(!n) return [];
    const buyers=((agreement&&agreement.meta&&agreement.meta.buyers)||[]).map(b=>String(b.name||'').replace(/\s+/g,'')).filter(Boolean);
    const isBank=s=>/בנק|טפחות|לאומי|הפועלים|דיסקונט|מזרחי|מרכנתיל|איגוד|אגוד|יהב|מסד|אוצר החייל|ירושלים/.test(String(s||''));
    return (n.warnings||[]).filter(w=>/הערת אזהרה/.test(String(w.type||''))&&w.in_favor_of&&!isBank(w.in_favor_of)&&!buyers.some(b=>{const f=String(w.in_favor_of).replace(/\s+/g,'');return f.includes(b)||b.includes(f);}));
  }

  // ── מנגנון הסכמה: זיהוי גופים מיוחדים בנסח ──
  function nasachHay(){ const n=nasach||{}; return (n.owners||[]).map(o=>o.name).join(' ')+' '+JSON.stringify(n._raw||'')+' '+(n.warnings||[]).map(w=>(w.in_favor_of||'')+' '+(w.detail||'')+' '+(w.type||'')).join(' '); }

  // ⚠️ תיקון כיול: זיהוי בעלות/חכירה בפועל מהמדינה — אך ורק מרישום הבעלים/החוכר עצמו (n.owners / n.chakira),
  // לא מתוכן הערות אזהרה. הערה יכולה לנקוב "לטובת מדינת ישראל" (למשל הערת "העברה לזרים" לפי סעיף 4יט לחוק רמ"י)
  // גם כשהבעלות פרטית לחלוטין ואין שום זיקת חכירה למדינה — לכן אסור לסרוק את שדות ההערות (in_favor_of/detail/type) כאן.
  function stateOwnershipHay(){ const n=nasach||{}; return (n.owners||[]).map(o=>o.name||'').join(' ')+' '+(n.chakira||[]).map(c=>(c.baal||c.owner||c.machkir||'')).join(' '); }
  function isStateBacked(){ const hay=stateOwnershipHay(); if(/מדינת ישראל/.test(hay))return 'מדינת ישראל (רמ"י)'; if(/רשות הפיתוח/.test(hay))return 'רשות הפיתוח (רמ"י)'; if(/קרן קיימת|קק"?ל|JNF/.test(hay))return 'קק"ל (רמ"י)'; return null; }
  // הערת "העברה לזרים" (סעיף 4יט לחוק רשות מקרקעי ישראל) — הערה כללית וקבועה של רמ"י, אינה שעבוד הניתן להסרה
  // ואינה מעידה על בעלות/חכירה מהמדינה. רלוונטית בפועל רק אם הרוכש בפועל זר — ראו שימוש ב-buildQuestions/m3BuildMilestones.
  function foreignTransferWarnings(){ const n=nasach; if(!n)return []; return (n.warnings||[]).filter(w=>/העברה לזרים|לזרים/.test(String(w.type||'')+' '+String(w.detail||''))); }

  // חברת גוש-חלקה: הבעלים הוא חברה ששמה כולל "חלקה X בגוש Y" / "גוש … חלקה …" + בע"מ, או הערת "בכפוף להעברת מניות"
  function isGushHelka(){ const n=nasach; if(!n)return false;
    const ownerNames=(n.owners||[]).map(o=>o.name||'').join(' ');
    if(/חלקה\s*\d+\s*בגוש\s*\d+.{0,6}בע"מ|גוש\s*\d+\s*חלקה\s*\d+.{0,6}בע"מ/.test(ownerNames))return true;
    if(/בכפוף להעברת מניות/.test(JSON.stringify(n._raw||'')+' '+nasachHay()))return true;
    return false;
  }
  function consentBodies(){ const n=nasach; if(!n)return []; const hay=nasachHay(); const bodies=[];
    const sb=isStateBacked();
    // עדיפות: חברת גוש-חלקה (הסכמת החברה / העברת מניות) לפני רמ"י
    if(isGushHelka()){ bodies.push('חברת גוש-חלקה (הסכמת החברה / העברת מניות)'); }
    else if(sb)bodies.push(sb);
    else if(n.chakira&&n.chakira.length)bodies.push('רמ"י / בעל המקרקעין (חכירה)');
    if(n.is_chevra_hamishkenet||/עמידר|חלמיש|חברה משכנת|החברה המשכנת/.test(hay)){ bodies.push(/עמידר/.test(hay)?'עמידר (חברה משכנת)':(/חלמיש/.test(hay)?'חלמיש (חברה משכנת)':'החברה המשכנת')); }
    if(/עיריי|עירית|מועצה מקומית|מועצה אזורית/.test(hay))bodies.push('הרשות המקומית');
    if(/מנהל אזרחי|המנהל האזרחי/.test(hay))bodies.push('המנהל האזרחי (מעבר לקו הירוק)');
    return Array.from(new Set(bodies));
  }

  function receiverNotes(){ const n=nasach; if(!n)return []; return (n.warnings||[]).filter(w=>/כונס נכסים|כינוס נכסים/.test(String(w.type||'')+' '+String(w.detail||''))); }
  function preConsentNotes(){ const n=nasach; if(!n)return []; return (n.warnings||[]).filter(w=>/הסכמה להעברה|הסכמה לירושה/.test(String(w.type||'')+' '+String(w.detail||''))); }
  function isChevra(){ const n=nasach; if(!n)return false; if(n.is_chevra_hamishkenet)return true; return /עמידר|חלמיש|חברה משכנת|החברה המשכנת/.test(nasachHay()); }

  // משכנתה הרשומה בנסח על שם המוכרים בעסקה זו בלבד (לא של חוכרים אחרים בנסח מרוכז/גוש-חלקה)
  function sellerNasachMortgage(agr){
    const n=nasach; if(!n)return false;
    const sellers=(agr&&agr.meta&&agr.meta.sellers)||[];
    const sNorm=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
    const sIds=sellers.map(s=>sNorm(s.id)).filter(Boolean);
    const sNames=sellers.map(s=>String(s.name||'').replace(/\s+/g,'')).filter(Boolean);
    const onSeller=arr=>(arr||[]).some(x=>{ const xid=sNorm(x.id), xn=String(x.name||'').replace(/\s+/g,''); return (xid&&sIds.includes(xid))||(xn&&sNames.some(sn=>sn.includes(xn)||xn.includes(sn))); });
    // משכנתאות מובנות (mashkantaot) עם לווים/על-החכירה-של תואמים למוכרים
    if((n.mashkantaot||[]).some(mk=>onSeller(mk.lovim)|| (mk.al_hachira_shel||mk.al_baalut_shel||[]).some(nm=>sNames.some(sn=>String(nm).replace(/\s+/g,'').includes(sn)))))return true;
    // הערות משכנתה עם צד תואם
    if((n.warnings||[]).some(w=>/משכנתה|משכנתא/.test(String(w.type||''))&&(onSeller(w.lovim)||onSeller(w.other_parties))))return true;
    // אם אין כלל מוכרים מזוהים אך יש משכנתה בודדת בנסח פרטני (לא מרוכז) — שמרני: נכלל
    if(!sIds.length&&!sNames.length&&!n.is_nasach_merukhaz&&(n.warnings||[]).some(w=>/משכנתה|משכנתא/.test(String(w.type||''))))return true;
    return false;
  }

  // חכירה אם: נתוני חכירה בנסח, גוף רמ"י/חכירה ב-consentBodies, או ownership=lease בהסכם
  function isLease(){ const n=nasach; if(!n)return false; if(n.chakira&&n.chakira.length)return true; if(consentBodies().some(b=>/רמ"י|חכירה|גוש-חלקה/.test(b)))return true; const o=(agreement&&agreement.meta&&agreement.meta.ownership)||''; return /חכיר/.test(String(o)); }
  // detect transaction type from a nasach object (parti or merukhaz)
  function detectDealType(n){
    if(!n) return {type:'unknown',label:'לא ידוע'};
    if(n.is_chevra_hamishkenet) return {type:'chevra',label:'חברה משכנת'};
    if((n.chakira&&n.chakira.length)||n.rama==='ראשית') return {type:'sublease',label:'חכירה / רמ"י'};
    if(n.tat_helka) return {type:'baitMeshutaf',label:'בית משותף'};
    return {type:'private',label:'בעלות פרטית (לא משותף)'};
  }

    return { developerNotes, nasachHay, stateOwnershipHay, isStateBacked, foreignTransferWarnings, isGushHelka, consentBodies, receiverNotes, preConsentNotes, isChevra, sellerNasachMortgage, isLease };
  }

  // ── fundamental mismatch check (used before allowing the flow to proceed) ──
  function fundamentalMismatch(nasach, agr){
    const ctx=makeCtx(nasach, agr);
    const n=nasach; if(!n) return null;
    const norm=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
    const ap=(agr.meta&&agr.meta.property)||{}; const reasons=[];
    if(n.gush&&ap.gush&&norm(n.gush)!==norm(ap.gush)) reasons.push('גוש שונה (נסח '+n.gush+' / הסכם '+ap.gush+')');
    if(n.helka&&ap.helka&&norm(n.helka)!==norm(ap.helka)) reasons.push('חלקה שונה (נסח '+n.helka+' / הסכם '+ap.helka+')');
    if(n.tat_helka&&ap.tat_helka&&norm(n.tat_helka)!==norm(ap.tat_helka)) reasons.push('תת-חלקה שונה (נסח '+n.tat_helka+' / הסכם '+ap.tat_helka+')');
    // בעלי הזכויות = בעלים + חוכרים (חברת גוש-חלקה/חכירה: המוכרים הם חוכרים, לא בעלים)
    const rh=(n.owners||[]).concat((n.chakira||[]).map(c=>({id:c.id,name:c.choker||c.name})));
    const rhIds=rh.map(o=>norm(o.id)).filter(Boolean);
    const rhNames=rh.map(o=>String(o.name||'').replace(/\s+/g,'')).filter(Boolean);
    const sellers=(agr.meta&&agr.meta.sellers)||[];
    if(sellers.length && rh.length){ let mm=0; sellers.forEach(s=>{ const sid=norm(s.id), snm=String(s.name||'').replace(/\s+/g,''); const idOk=sid&&rhIds.includes(sid); const nmOk=snm&&rhNames.some(on=>on.includes(snm)||snm.includes(on)); if(!idOk&&!nmOk)mm++; }); if(mm/sellers.length>0.5) reasons.push('רוב המוכרים בהסכם אינם מופיעים כבעלי זכויות בנסח ('+mm+'/'+sellers.length+')'); }
    return reasons.length?reasons.join('; '):null;
  }

  // ── STEP 2 validation: cross-check agreement vs nasach ──
  function runValidationCore(nasach, agr){
    const ctx=makeCtx(nasach, agr);
    const n=nasach; if(!n){return [];}
    const flags=[]; const ap=(agr.meta&&agr.meta.property)||{}; const norm=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
    if(n.gush&&ap.gush&&norm(n.gush)!==norm(ap.gush))flags.push({l:'red',t:'גוש בהסכם ('+ap.gush+') שונה מהנסח ('+n.gush+')'});
    if(n.helka&&ap.helka&&norm(n.helka)!==norm(ap.helka))flags.push({l:'red',t:'חלקה בהסכם ('+ap.helka+') שונה מהנסח ('+n.helka+')'});
    if(n.tat_helka&&ap.tat_helka&&norm(n.tat_helka)!==norm(ap.tat_helka))flags.push({l:'orange',t:'תת-חלקה בהסכם ('+ap.tat_helka+') שונה מהנסח ('+n.tat_helka+')'});
    // בעלי הזכויות = בעלים + חוכרים (חברת גוש-חלקה: המוכרים הם חוכרים)
    const isLeaseNasach=((n.chakira||[]).length>0)&&((n.owners||[]).every(o=>/בע[״"]מ|בעמ|חברה|מדינת ישראל|רשות הפיתוח|קרן קיימת|קק/.test(o.name||'')));
    const rh=(n.owners||[]).concat((n.chakira||[]).map(c=>({id:c.id,name:c.choker||c.name})));
    const ownerIds=rh.map(o=>norm(o.id)).filter(Boolean);
    const ownerNames=rh.map(o=>String(o.name||'').replace(/\s+/g,'').trim()).filter(Boolean);
    const sellers=(agr.meta&&agr.meta.sellers)||[];
    sellers.forEach(s=>{ const sid=norm(s.id); const snm=String(s.name||'').replace(/\s+/g,'').trim();
      if(sid&&ownerIds.length&&!ownerIds.includes(sid))flags.push({l:'red',t:'ת.ז המוכר "'+s.name+'" ('+s.id+') אינה מופיעה כבעל זכויות בנסח — בדוק את מספר הזיהוי (לעיתים מופיע עם/בלי 0 מוביל)'});
      if(snm&&ownerNames.length&&!ownerNames.some(on=>on.includes(snm)||snm.includes(on)))flags.push({l:'orange',t:'שם המוכר בהסכם "'+s.name+'" אינו תואם בדיוק לשם בנסח — בדוק'});
    });
    // ── בדיקת מספר הבעלים: חסר/עודף בעל זכויות — לא בחברת גוש-חלקה (הבעלים הוא חברה) ──
    // ⚠️ תיקון כיול: לספור בעלי-זכויות ייחודיים (dedupe לפי ת.ז מנורמלת, ובהיעדרה — לפי שם מנורמל) ולא רשומות גולמיות.
    // אותו אדם עשוי להופיע בכמה רשומות בעלות בנסח (למשל: רכש 1/2 ב"מכר", וירש את ה-1/2 הנוספים ב"צוואה") —
    // זה עדיין בעל-זכויות אחד, לא שניים, ואין להשוותו כשגיאה מול מספר המוכרים בהסכם.
    const uniqueOwners=(function(){ const seen=[]; const out=[];
      (n.owners||[]).forEach(o=>{ const oid=norm(o.id); const onm=String(o.name||'').replace(/\s+/g,'').trim();
        const hit=seen.find(s=>(oid&&s.id===oid)||(!oid&&!s.id&&onm&&s.name===onm));
        if(hit)return; seen.push({id:oid,name:onm}); out.push(o); });
      return out; })();
    const nOwners=uniqueOwners.length, nSellers=sellers.length;
    if(!isLeaseNasach && nOwners&&nSellers&&nOwners!==nSellers){ flags.push({l:'red',t:'מספר הבעלים הייחודיים בנסח ('+nOwners+', לאחר איחוד רשומות של אותו אדם) שונה ממספר המוכרים בהסכם ('+nSellers+') — ייתכן שבעל זכויות חסר או עודף. אי אפשר למכור ללא חתימת כל בעלי הזכויות. יש לוודא שכל בעלי הזכויות צד להסכם (ולוודא ת.ז ושם של כל אחד).'}); }
    // בעלים שמופיעים בנסח אך אינם צד בהסכם — לא בחברת גוש-חלקה (הבעלים הוא חברה, לא צד)
    const sellerIds=sellers.map(s=>norm(s.id)).filter(Boolean);
    const sellerNames=sellers.map(s=>String(s.name||'').replace(/\s+/g,'').trim()).filter(Boolean);
    if(!isLeaseNasach)(n.owners||[]).forEach(o=>{ const oid=norm(o.id), onm=String(o.name||'').replace(/\s+/g,'').trim(); const idOk=oid&&sellerIds.includes(oid); const nmOk=onm&&sellerNames.some(sn=>sn.includes(onm)||onm.includes(sn)); if((oid||onm)&&!idOk&&!nmOk)flags.push({l:'red',t:'בעל הזכויות "'+(o.name||'')+'"'+(o.id?(' (ת.ז '+o.id+')'):'')+' מופיע בנסח אך אינו צד בהסכם המכר — בדוק.'}); });
    const nasachMort=ctx.sellerNasachMortgage(agr); const agrMort=agr.seller_mortgage&&agr.seller_mortgage.exists;
    if(nasachMort&&!agrMort)flags.push({l:'orange',t:'בנסח רשומה משכנתה על שם המוכרים אך ההסכם אינו מזכיר את סילוקה — נוסיף משימת סילוק.'});
    return flags;
  }

  // ── STEP 3: build the dynamic clarification questions ──
  function buildQuestionsCore(nasach, agr){
    const ctx=makeCtx(nasach, agr);
    const questions=[]; const defaults={};
    const signIso=agr.meta&&agr.meta.sign_date_iso;
    if(!signIso){ questions.push({id:'sign_date',level:'critical',type:'date',text:'מועד העסקה איננו מופיע בטיוטה! מהו יום העסקה (תאריך חתימת ההסכם)?',impact:'יום העסקה הוא עוגן לכל לוח התשלומים והמשימות.'}); }
    else { defaults.sign_date=signIso; }
    (agr.conditions||[]).forEach((cond,i)=>{ questions.push({id:'cond_'+i,level:'critical',type:'condition',condIndex:i,cond:cond,text:'תנאי מתלה: "'+(cond.text||'')+'" — האם התקיים?',impact:'אם התקיים — יום קיומו הופך לעוגן לוח התשלומים. אם לא — הלוח נשאר בהמתנה (PENDING).'}); });
    // ── שאלת משכנתת קונה — ניסוח דינמי לפי אחוז ההון העצמי (25% / 50%) ──
    let bmText='האם הקונה לוקח משכנתה? (לא מופיע בהסכם)';
    (function(){
      const total=parseNum((agr.meta&&agr.meta.price)||''); const pays=(agr.payments||[]).map(p=>parseNum(p.amount));
      if(!total||!pays.length) return;
      let cum=0,eqIdx=-1,eqPct=null;
      for(let i=0;i<pays.length;i++){ cum+=pays[i]; const pct=cum/total*100;
        if(Math.abs(pct-25)<=1.5){ eqIdx=i; eqPct=25; break; } if(Math.abs(pct-50)<=1.5){ eqIdx=i; eqPct=50; break; } }
      if(eqIdx===0){ bmText='היות והתשלום הראשון מהווה '+eqPct+'% מסך התמורה, ניתן להניח שיתרת התמורה (מהתשלום הבא ואילך) ממומנת ממשכנתת הקונה. האם זה אכן כך? (לא מופיע בהסכם)'; }
      else if(eqIdx>0){ bmText='היות והתשלומים הראשונים (עד תשלום '+(eqIdx+1)+' בכלל) משלימים ל-'+eqPct+'% מסך התמורה, ניתן להניח שיתרת התמורה (מתשלום '+(eqIdx+2)+' ואילך) ממומנת ממשכנתת הקונה. האם זה אכן כך? (לא מופיע בהסכם)'; }
    })();
    questions.push({id:'buyer_mortgage',level:'critical',type:'buyer_mortgage',text:bmText,impact:'אם כן — נכניס את תהליך משכנתת הקונה: התהליך נמשך כחודשיים, וכשבועיים-שלושה לפני התשלום על ב"כ הקונה לקבל את מסמכי המשכנתה, להחתים את הקונה ולהעבירם לב"כ המוכר.'});
    const n=nasach; const nasachMort=ctx.sellerNasachMortgage(agr); const sm=agr.seller_mortgage||{};
    if((nasachMort||sm.exists)&&!sm.payoff_deadline_iso){ questions.push({id:'seller_mortgage_payoff',level:'clarify',type:'date',text:'מה התאריך שהמוכר חייב לסלק את המשכנתה? (לא נמצא תאריך בהסכם)',impact:'אחרי הסילוק יש 30 יום למחיקת המשכנתה מהנסח.'}); }
    const ta=agr.trustee_amount||{};
    if(ta.exists&&ta.amount){ const x=ta.amount_shevach, y=ta.amount_iriya; const breakdown=(x||y)?(' ('+(x?(x+' לטובת הפקת אישור מס שבח'):'')+((x&&y)?' + ':'')+(y?(y+' לטובת הפקת אישור עירייה כולל היטל השבחה'):'')+')'):''; questions.push({id:'trustee_confirm',level:'clarify',type:'confirm',value:ta.amount,text:'סכום בנאמנות שזוהה: '+ta.amount+breakdown+' — המצאת אישור מס שבח המופנה לרשם המקרקעין ו/או אישור עירייה (כולל היטל השבחה) לרשם המקרקעין. האם הסכום בנאמנות נכון?',impact:'הסכום נשאר בידי ב"כ המוכר עד המצאת האישורים.'}); }
    if(n){ const crit=(n.warnings||[]).filter(w=>/עיקול|תקנה 27|תקנה 29|צו הריסה|הערה אחרת/.test(String(w.type||''))); if(crit.length){ questions.push({id:'nasach_critical_ack',level:'critical',type:'choice',choices:['הבנתי — הוסף משימת טיפול','אין צורך'],text:'בנסח רשומות הערות חריגות ('+crit.map(w=>w.type).join(', ')+'). להוסיף משימת טיפול לעו"ד המוכר?',impact:'משימת הסילוק תתוזמן משבוע מיום העסקה ועד המסירה, באחריות עו"ד המוכר.'}); } }
    // ── הערת "העברה לזרים" (סעיף 4יט לחוק רמ"י) — שאלה מידעית בלבד, לא גוררת משימת טיפול/הסכמת רמ"י אוטומטית ──
    { const foreignT=ctx.foreignTransferWarnings();
      if(foreignT.length){ questions.push({id:'foreign_transfer_ack',level:'clarify',type:'choice',choices:['ידוע לי','לא ידעתי — לציין בדוח'],
        text:'בנסח רשומה הערה כללית של רמ"י בדבר "העברה לזרים" לטובת מדינת ישראל (סעיף 4יט לחוק רשות מקרקעי ישראל תש"ך-1960). זו הערה קבועה שאינה נמחקת ואינה טעונה טיפול/ניקוי מצד המוכר — היא הופכת רלוונטית רק אם הרוכש בפועל זר, ואז ייתכן (לא בטוח) שהטאבו ידרוש אישור רמ"י להשלמת הרישום. האם ידוע לך על ההערה?',
        impact:'לא נדרשת פעולה של המוכר בגין הערה זו; אם הרוכש זר — מומלץ לברר מול פקיד הטאבו בעת הגשת שטר המכר.'}); } }
    // ── התחדשות עירונית: שאלת אימות + שם היזם ──
    const ur=(agr.urban_renewal)||{}; const devNotes=ctx.developerNotes(); const devNames=[].concat(ur.developers||[]).concat(devNotes.map(w=>w.in_favor_of)).filter(Boolean);
    if(ur.mentioned||devNotes.length){
      const nameTxt=devNames.length?(' (יזם: '+Array.from(new Set(devNames)).join(' · ')+')'):' (שם היזם לא זוהה — נא להשלים)';
      questions.push({id:'urban_renewal_signed',level:'critical',type:'choice',choices:['כן — נחתם הסכם התחדשות','לא / לא ברור'],
        text:'האם נחתם הסכם התחדשות עירונית עם היזם?'+nameTxt,
        impact:'אם נחתם — על הקונה ליצור קשר עם היזם ולחתום על מסמכי הפרויקט תוך 7 ימים מיום הסכם המכר. נוסיף משימה בהתאם.'});
    }
    return { questions, defaults };
  }

  // ── STEP 4: build the milestones/tasks list ──
  function buildMilestonesCore(nasach, agreement, answers){
    const ctx=makeCtx(nasach, agreement);
    const agr=agreement, A=answers, n=nasach; if(!agr){ return null; }
    const signIso=A.sign_date||(agr.meta&&agr.meta.sign_date_iso)||null;
    let anchorIso=signIso; let pending=false,pendingNote=''; const dateFlags=[]; const condReminders=[]; const resolutory=[];
    (agr.conditions||[]).forEach((cond,i)=>{
      const kind=(cond.kind||'מתלה');
      if(kind==='מפסיק'){ resolutory.push(cond); return; }
      const st=A['cond_'+i];
      if(st==='fulfilled'){
        const fd=A['cond_'+i+'_date']; let valid=true, reason='';
        if(fd&&signIso&&fd<signIso){ valid=false; reason='לפני תאריך החתימה'; }
        if(fd&&cond.original_deadline_iso&&fd>cond.original_deadline_iso){ valid=false; reason='אחרי הדדליין של התנאי ('+(cond.original_deadline||'')+')'; }
        if(fd&&valid){ anchorIso=fd; }
        else if(fd&&!valid){ dateFlags.push('🚨 תאריך קיום התנאי "'+(cond.text||'')+'" אינו עקבי ('+reason+') — לא נשמר כעוגן. בדוק מול ב"כ הצד השני.'); }
      } else if(st==='pending'){
        pending=true;
        pendingNote='התנאי המתלה "'+(cond.text||'')+'" טרם התקיים'+(cond.original_deadline?(' (תקופה: עד '+cond.original_deadline+')'):'')+(cond.extension_allowed?' · ניתן להאריך':'')+'.';
        if(cond.original_deadline_iso) condReminders.push({text:cond.text||'',deadline:cond.original_deadline_iso,disp:cond.original_deadline||isoToDisplay(cond.original_deadline_iso)});
      }
    });
    const closingDate=anchorIso;
    const _delv=agr.delivery||{}; const deliveryIso=_delv.date_iso||''; const deliveryDate=deliveryIso; const anomalies=[]; const urFlags=[]; const consentFlags=[]; const crossTatFlags=[];
    // ── מסמך ישן (מעל חצי שנה) — נסח ו/או טיוטה/הסכם — דורש בדיקה מדוקדקת ──
    (function(){
      const SIX_MO=183*86400000; const now=Date.now();
      const nd=(n&&n.nasach_date&&typeof _parseHebDate==='function')?_parseHebDate(n.nasach_date):null;
      const ndt=(nd&&nd.getTime)?nd.getTime():null;
      if(ndt&&!isNaN(ndt)&&(now-ndt)>SIX_MO){ const months=Math.floor((now-ndt)/(30.4*86400000)); anomalies.push('🗓️ הנסח שהועלה הופק לפני כ-'+months+' חודשים ('+n.nasach_date+') — לפני יותר מחצי שנה. מצב הזכויות, ההערות והמשכנתאות עשוי להשתנות. יש להפיק נסח עדכני ולבדוק היטב מול הלקוח לפני הסתמכות.'); }
      const sd=(agr.meta&&agr.meta.sign_date_iso)?new Date(agr.meta.sign_date_iso):null;
      if(sd&&!isNaN(sd)&&(now-sd.getTime())>SIX_MO){ const months=Math.floor((now-sd.getTime())/(30.4*86400000)); anomalies.push('🗓️ ההסכם/הטיוטה שהועלו נחתמו לפני כ-'+months+' חודשים — לפני יותר מחצי שנה. ייתכן שהפרטים, המועדים או הסטטוס השתנו. יש לבדוק היטב מול הלקוח שהמסמך עדכני ורלוונטי לעסקה.'); }
    })();
    // ── תת-חלקות נוספות שבהן מופיעים שמות המוכרים/בעלי הזכויות (בית משותף מרוכז) ──
    crossTatFlags.length=0;
    (function(){
      const raw=(n&&n._raw)||null; if(!raw)return;
      const mAll=(raw.all_owners)||[]; const mChak=(raw.all_chakira||raw.chakira)||[];
      const selTat=String((n.tat_helka)||(typeof window!=='undefined'&&window._currentSelectedTat)||'').trim();
      if(!mAll.length||!selTat)return;
      const norm=v=>String(v||'').replace(/[\s\-]/g,'').replace(/^0+/,'');
      // בעלי הזכויות בתת-החלקה הנבחרת (בעלים + חוכרים)
      const selNames=mAll.filter(o=>String(o.tat_helka||'').trim()===selTat).map(o=>(o.name||'').toLowerCase().trim())
        .concat(mChak.filter(c=>String(c.tat_helka||'').trim()===selTat).map(c=>(c.choker||c.name||'').toLowerCase().trim())).filter(Boolean);
      const selIds=mAll.filter(o=>String(o.tat_helka||'').trim()===selTat).map(o=>norm(o.id))
        .concat(mChak.filter(c=>String(c.tat_helka||'').trim()===selTat).map(c=>norm(c.id))).filter(Boolean);
      if(!selNames.length&&!selIds.length)return;
      const allH=mAll.map(o=>({name:o.name,id:o.id,tat:String(o.tat_helka||'').trim(),sug:o.sug_peula,kind:'בעלים'}))
        .concat(mChak.map(c=>({name:c.choker||c.name,id:c.id,tat:String(c.tat_helka||'').trim(),sug:c.sug_peula||'חכירה',kind:'חוכר'})));
      const cross={};
      allH.forEach(o=>{ if(!o.tat||o.tat===selTat)return; const nm=(o.name||'').toLowerCase().trim(); const oid=norm(o.id);
        const hit=selNames.some(sn=>sn&&nm&&(sn===nm||sn.includes(nm)||nm.includes(sn)))||(oid&&selIds.includes(oid));
        if(!hit)return; const k=o.name+'|'+o.tat; if(!cross[k])cross[k]={name:o.name,tat:o.tat,sug:o.sug,kind:o.kind}; });
      const list=Object.keys(cross).map(k=>cross[k]).sort((a,b)=>parseInt(a.tat)-parseInt(b.tat));
      if(list.length){
        const detail=list.map(c=>c.kind+' '+c.name+' — תת-חלקה '+c.tat+(c.sug?' ('+c.sug+')':'')).join(' · ');
        crossTatFlags.push('בעלי הזכויות בתת-חלקה '+selTat+' מופיעים גם בתת-חלקות נוספות: '+detail+'. יש לוודא מול ההסכם האם זכויות אלו (חניה / מחסן / דירה נוספת) כלולות בעסקה או נפרדות ממנה.');
      }
    })();
    const _payments0=agr.payments||[]; const _lastPayIso=(function(){ for(let i=_payments0.length-1;i>=0;i--){ if(_payments0[i].iso) return _payments0[i].iso; } return deliveryIso; })();
    const ms=[]; let uid=0; const push=o=>{ o.id='m'+(uid++); o.status='proposed'; ms.push(o); return o; };
    const addr=(agr.meta&&agr.meta.property&&agr.meta.property.address)||(agr.meta&&agr.meta.title)||'העסקה';
    const sm0=agr.seller_mortgage||{}; const hasSellerMort=sm0.exists||ctx.sellerNasachMortgage(agr);
    const chevra=ctx.isChevra(); const hasTat=!!(n&&n.tat_helka);
    // ── #5 הגשת ורישום הערת אזהרה לטובת הקונה (בטאבו) — גם בעסקת חברה משכנת (רישום מקביל) ──
    const haChevraDesc=(chevra&&!hasTat)?' — ברמת החלקה (אין תת-חלקה); לכלול זיהוי תיאורי של הדירה: קומה, מס׳ דירה, מס׳ בניין, כיווני אוויר':'';
    const haSubmit=push({t:'הגשת בקשה לרישום הערת אזהרה לטובת הקונה (בטאבו)'+haChevraDesc,who:'ב"כ הקונה',critical:true,dateIso:anchorIso?addDays(anchorIso,1):'',dateText:anchorIso?'ביום העסקה / עד יום אחרי':'ביום העסקה / יום אחרי',dep:'הצדדים חותמים על הבקשה ביום העסקה; ההגשה עצמה היא משימה'});
    push({t:'מעקב: לוודא שב"כ הקונה הגיש את בקשת הערת האזהרה',who:'ב"כ המוכר',critical:false,dateIso:anchorIso?addDays(anchorIso,2):'',dateText:'יום-יומיים לאחר העסקה',dep:'מעקב אחר ביצוע ע"י ב"כ הקונה'});
    push({t:'רישום הערת אזהרה — ועם הרישום: שחרור ההמחאה מהנאמנות לידי המוכר',who:'מעקב ב"כ הקונה / ב"כ המוכר',critical:true,dateIso:anchorIso?addDays(anchorIso,3):'',dateText:'כ-3 ימי לשכה לאחר ההגשה. אם לא נרשמה תוך 3 ימים מסיבה שאינה באחריות הקונה — ההמחאה נשארת בנאמנות',dep:'תלוי בהגשת בקשת הערת האזהרה'});
    // ── payments with systemic dependencies ──
    const payments=agr.payments||[];
    const dpIndex=payments.findIndex(p=>p.is_down_payment||p.held_in_trust||/נאמנות|נאמן/.test(String(p.payee||'')));
    payments.forEach((p,i)=>{
      const deps=[];
      if(i===dpIndex){ deps.push('מוחזק בנאמנות עד רישום הערת אזהרה'); }
      else if(i===0){ deps.push('תלוי ברישום הערת אזהרה'); }
      const isSecond=(dpIndex>=0)?(i===dpIndex+1):(i===1);
      if(isSecond){ deps.push('תלוי ברישום הערת האזהרה (תנאי מערכתי)'); if(hasSellerMort) deps.push('תלוי בהפקת מכתב כוונות עדכני ע"י המוכר'); }
      if(hasSellerMort && payments.length>1 && i===payments.length-1){ deps.push('תלוי במחיקת המשכנתה והפקת נסח/דו"ח עיון נקי'); }
      push({t:'תשלום '+(p.number||(i+1))+': '+(p.amount||'')+(p.payee?(' '+le(p.payee)):''),who:'קונה',critical:false,dateIso:pending?'':(p.iso||''),dateText:p.when||'לפי ההסכם',dep:deps.length?deps.join(' · '):null,pending:pending,reminder:'התראה שבוע לפני: "תשלום בעסקת '+addr+' מתקרב"',payCond:p.cond||''});
    });
    // ── מקדמה בנאמנות התלויה בתנאי מתלה ──
    const hasMatla=(agr.conditions||[]).some(c=>(c.kind||'מתלה')!=='מפסיק');
    const dp=dpIndex>=0?payments[dpIndex]:null;
    if(hasMatla&&dp){
      push({t:'מקדמה מוחזקת בנאמנות ע"י ב"כ המוכר עד קיום התנאי המתלה'+(dp.amount?(' ('+dp.amount+')'):''),who:'נאמן (ב"כ המוכר)',critical:true,dateIso:'',dateText:'מהחתימה ועד קיום התנאי',dep:null});
      const anyFulfilled=(agr.conditions||[]).some((c,i)=>(c.kind||'מתלה')!=='מפסיק'&&A['cond_'+i]==='fulfilled');
      const anyPending=(agr.conditions||[]).some((c,i)=>(c.kind||'מתלה')!=='מפסיק'&&A['cond_'+i]==='pending');
      if(anyFulfilled) push({t:'שחרור המקדמה למוכר (התנאי המתלה התקיים)',who:'נאמן (ב"כ המוכר)',critical:false,dateIso:anchorIso||'',dateText:'עם קיום התנאי',dep:'תלוי בקיום התנאי המתלה'});
      else if(anyPending) push({t:'⚠️ באי-קיום התנאי המתלה — החזרת המקדמה לקונה',who:'נאמן (ב"כ המוכר)',critical:true,dateIso:'',dateText:'אם התנאי לא יתקיים בתוך התקופה',dep:'תלוי באי-קיום התנאי המתלה'});
    }
    // ── התראת סיום תקופת התנאי המתלה (7 ימים לפני) ──
    condReminders.forEach(cr=>{ push({t:'סיום תקופת התנאי המתלה: '+cr.text,who:'שני הצדדים / ב"כ',critical:true,dateIso:cr.deadline,dateText:'עד '+cr.disp,dep:null,deadlineReminder:true}); });
    // ── תנאי מפסיק (נדיר) — מעקב, החוזה בתוקף ──
    resolutory.forEach(c=>{ push({t:'מעקב תנאי מפסיק: '+(c.text||''),who:'ב"כ',critical:true,dateIso:'',dateText:'החוזה בתוקף; יחדל אם התנאי יתרחש',dep:null}); });
    const sm=agr.seller_mortgage||{}; const nasachMort=ctx.sellerNasachMortgage(agr);
    if(sm.exists||nasachMort){
      const payoffIso=sm.payoff_deadline_iso||A.seller_mortgage_payoff||'';
      // #3 letter of intent — its own task, reminder ~1 month before payoff
      push({t:'תזכורת לב"כ המוכר: להודיע למוכר להפיק מכתב כוונות עדכני (בתוקף ובמקור) שהסכום בו אינו עולה על דו"ח היתרות; להעביר את מכתב הכוונות לקונה ועותק לב"כ הקונה',who:'ב"כ המוכר → מוכר',critical:true,dateIso:payoffIso?addDays(payoffIso,-30):'',dateText:payoffIso?('כחודש לפני '+isoToDisplay(payoffIso)):'~חודש לפני תשלום הסילוק',dep:null});
      push({t:'סילוק משכנתת המוכר'+(sm.bank?(' ('+sm.bank+')'):''),who:'מוכר',critical:true,dateIso:payoffIso,dateText:sm.payoff_text||(payoffIso?('עד '+isoToDisplay(payoffIso)):'עד המסירה'),dep:'מצריך מכתב כוונות עדכני מהבנק'});
      const deletionIso=payoffIso?addDays(payoffIso,30):'';
      // #4 deletion is its own task; status-check ~2 weeks after payoff; clean docs ~3 days before final payment
      push({t:'מחיקת המשכנתה מהנסח ומרשם המשכונות (הפקת נסח/דו"ח עיון נקי)',who:'מוכר + בנק',critical:true,dateIso:deletionIso,dateText:'תוך 30 יום מהסילוק',dep:'תלוי בסילוק המשכנתה (שתלוי במכתב הכוונות)'});
      push({t:'בדיקת סטטוס מחיקת המשכנתה מול הבנק',who:'ב"כ המוכר',critical:false,dateIso:payoffIso?addDays(payoffIso,14):'',dateText:'כשבועיים לאחר הסילוק',dep:'מעקב מוקדם כדי לוודא שהמחיקה מתקדמת'});
      push({t:'הגשת מסמכי המחיקה (נסח/דו"ח עיון נקי) לקונה',who:'מוכר → קונה',critical:true,dateIso:_lastPayIso?addDays(_lastPayIso,-3):'',dateText:'כ-3 ימים לפני התשלום האחרון',dep:'תלוי במחיקת המשכנתה'});
      // #5 validation: deletion must precede final payment / delivery
      const finalRef=_lastPayIso||deliveryIso;
      if(deletionIso&&finalRef&&deletionIso>finalRef){ anomalies.push('מחיקת המשכנתה הצפויה ('+isoToDisplay(deletionIso)+') מאוחרת מהתשלום האחרון/המסירה ('+isoToDisplay(finalRef)+'). המשכנתה אמורה להיות מסולקת ונמחקת <b>לפני</b> התשלום האחרון — בדוק והסדר.'); }
    }
    if(A.buyer_mortgage==='yes'){ const bm=A.buyer_mortgage_date||'';
      if(bm){ const diffs=_payments0.map(p=>p.iso).filter(Boolean).map(iso=>Math.abs((new Date(bm+'T00:00:00Z')-new Date(iso+'T00:00:00Z'))/86400000)); const minDiff=diffs.length?Math.min.apply(null,diffs):999; if(minDiff>14){ anomalies.push('מועד תשלום המשכנתה שהוזן ('+isoToDisplay(bm)+') רחוק ממועדי התשלום בהסכם (פער של כ-'+Math.round(minDiff)+' ימים מהמועד הקרוב). ייתכן פער מהותי מההסכם — בדוק, אך ניתן להמשיך.'); } }
      push({t:'תחילת תהליך משכנתת הקונה (התהליך נמשך כחודשיים)',who:'קונה',critical:false,dateIso:bm?addDays(bm,-60):'',dateText:bm?('להתחיל כחודשיים לפני '+isoToDisplay(bm)):'~חודשיים לפני התשלום',dep:null,info:true}); push({t:'קבלת מסמכי המשכנתה, החתמת הקונה והעברה לב"כ המוכר (שיחתים את המוכר)',who:'ב"כ הקונה',critical:false,dateIso:bm?addDays(bm,-21):'',dateText:bm?('שבועיים-שלושה לפני '+isoToDisplay(bm)):'~שבועיים-שלושה לפני התשלום',dep:null}); push({t:'הגשת בקשה לרישום הערת אזהרה לטובת בנק הקונה + הגשת מלוא המסמכים לבנק',who:'ב"כ הקונה',critical:false,dateIso:bm?addDays(bm,14):'',dateText:bm?('עד שבועיים מ-'+isoToDisplay(bm)):'~שבועיים מתשלום המשכנתה',dep:'לאחר החתמת הקונה'}); }
    else if(A.buyer_mortgage==='unknown'){ push({t:'לברר עם הקונה האם ומתי הוא לוקח משכנתה (הודעה)',who:'ב"כ הקונה',critical:false,dateIso:'',dateText:'בהקדם',dep:null,info:true}); }
    const ta=agr.trustee_amount||{};
    // ── פיקדון המיסים מוחזק בנאמנות ──
    if(ta.exists){ const bd=[ta.amount_shevach&&(ta.amount_shevach+' למס שבח'),ta.amount_iriya&&(ta.amount_iriya+' לעירייה/היטל השבחה')].filter(Boolean).join(' + '); push({t:'החזקת כספים בנאמנות (פיקדון המיסים)'+(ta.amount?(' — '+ta.amount):'')+(bd?(' ('+bd+')'):''),who:'נאמן (ב"כ המוכר)',critical:true,dateIso:'',dateText:'מוחזק עד הפקת אישורי מס שבח ועירייה (היטל השבחה)',dep:null}); }
    // ── הזמנת אישור עירייה כחודש לפני המסירה ──
    if(deliveryIso){ push({t:'הזמנת אישור עירייה (לרשם המקרקעין, כולל היטל השבחה)',who:'ב"כ המוכר / מוכר',critical:false,dateIso:addDays(deliveryIso,-30),dateText:'כחודש לפני המסירה',dep:null}); }
    // ── בדיקה שבועיים לפני המסירה: האם התקבלו אישורי המיסים ──
    if(deliveryIso){ push({t:'בדיקה: האם התקבלו אישורי המיסים (מס שבח + עירייה)?',who:'ב"כ המוכר + הקונה/ב"כ הקונה',critical:true,dateIso:addDays(deliveryIso,-14),dateText:'שבועיים לפני המסירה',dep:'אם לא התקבלו — להסדיר נאמנות: חשבון נאמנות ייעודי או העברת הסכום לחשבון פקדונות ב"כ המוכר',preDeliveryCheck:true}); }
    // ── מועד אחרון לשימוש בכספי הנאמנות: 8 חודשים מהמסירה (זמן עבודת הרשויות) ──
    const eightMo=deliveryIso?addMonths(deliveryIso,8):''; push({t:'מועד אחרון לשימוש בכספי הנאמנות להסדרת חובות המוכר ולהפקת האישורים',who:'נאמן (ב"כ המוכר)',critical:true,dateIso:eightMo,dateText:eightMo?('עד '+isoToDisplay(eightMo)+' (8 חודשים מהמסירה — זמן עבודת הרשויות)'):'8 חודשים מהמסירה',dep:'האישורים עשויים להיות מופקים מוקדם יותר; אם טרם — שימוש בפיקדון להסדרת חובות'});
    // ── אנומליה: ההסכם קובע בסיס שונה ל-8 החודשים (לרוב מהחתימה במקום מהמסירה) ──
    if(/חתימ/.test(String(ta.deadline||''))){ anomalies.push('ההסכם קובע את מועד הפקת האישורים/השימוש בנאמנות לפי <b>מועד החתימה</b> ("'+ta.deadline+'"), בעוד הכלל הרגיל הוא <b>8 חודשים מהמסירה</b> (זמן עבודת הרשויות). שים לב לפער ובדוק.'); }
    // ── מיסוי מקרקעין (מעוגן ליום העסקה — יום המכירה לצורכי מס) ──
    push({t:'הגשת הצהרות מיסוי מקרקעין למשרד מיסוי מקרקעין (מוכר + קונה)',who:'ב"כ המוכר + ב"כ הקונה',critical:true,dateIso:anchorIso?addDays(anchorIso,30):'',dateText:'עד 30 יום מיום העסקה (סעיף 73 לחוק מיסוי מקרקעין)',dep:null});
    push({t:'תשלום מס רכישה',who:'קונה',critical:true,dateIso:anchorIso?addDays(anchorIso,60):'',dateText:'עד 60 יום מיום העסקה',dep:null});
    const shevachNote=(agr.tax_notes||[]).find(t=>/שבח/.test(String(t)));
    push({t:'תשלום מס שבח',who:'מוכר',critical:false,dateIso:'',dateText:shevachNote?('בהתאם להסכם: '+shevachNote):'בהתאם להסכם; אם לא צוין — חובת הצהרה ושומה עצמית תוך 30 יום מיום העסקה (סעיף 73), והתשלום לפי השומה',dep:null});
    // ── התחדשות עירונית ──
    const ur=(agr.urban_renewal)||{}; const devNotes=ctx.developerNotes();
    const devNames=Array.from(new Set([].concat(ur.developers||[]).concat(devNotes.map(w=>w.in_favor_of)).filter(Boolean)));
    // משימות יזם רק אם המשתמש אישר שנחתם הסכם התחדשות (yes) או שקיימת הערת יזם בנסח — לא רק כי "מאוזכר"
    const urActive=(A.urban_renewal_signed==='yes')||devNotes.length>0;
    if(urActive){
      const days=ur.sign_project_docs_days||7; const nm=devNames.length?(' (יזם: '+devNames.join(' · ')+')'):'';
      push({t:'יצירת קשר עם היזם'+nm+' וחתימה על מסמכי הפרויקט',who:'קונה',critical:true,dateIso:anchorIso?addDays(anchorIso,days):'',dateText:'תוך '+days+' ימים מיום הסכם המכר',dep:null});
      // מנגנון הסכמת יזם — כתב הסכמה + פרוטוקול, נדרשים לרישום בטאבו
      const bm=A.buyer_mortgage==='yes';
      push({t:'פנייה לב"כ היזם לקבלת כתב הסכמה לעסקת המכר'+(bm?' ולמשכנתא':'')+' והפקת פרוטוקול היזם',who:'קונה / ב"כ הקונה',critical:true,dateIso:anchorIso||'',dateText:'בהקדם — ללא כתב ההסכמה והפרוטוקול הטאבו לא ירשום את המכר'+(bm?' והמשכנתא':'')+' בעסקת התחדשות עירונית',dep:null});
      if(bm){ push({t:'מומלץ לבקש מהיזם את כתב ההסכמה והפרוטוקול בהקדם (טרם המסירה) — לייעול תהליך רישום סופי של המכר והמשכנתא',who:'ב"כ הקונה',critical:false,dateIso:'',dateText:'בשלב מוקדם של תהליך המשכנתא',dep:null,info:true}); }
    }
    // נקודה 5: בנסח הערת יזם אך ההסכם אינו מזכיר התחדשות → דגל + משימה
    if(devNotes.length&&!ur.mentioned){
      urFlags.push('בנסח רשומה הערת אזהרה לטובת יזם'+(devNames.length?(' ('+devNames.join(' · ')+')'):'')+' אך הסכם המכר אינו מזכיר התחדשות עירונית — יש לברר אם הנכס בתהליך התחדשות והאם הדבר משפיע על העסקה.');
      push({t:'בירור: בנסח הערת יזם אך ההסכם אינו מזכיר התחדשות עירונית — לוודא סטטוס מול הצדדים',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'בהקדם',dep:null});
    }
    // נקודה 4: הסכם התחדשות מאוזכר אך אין הערת יזם על בעלי הזכויות בנסח
    if((ur.mentioned||A.urban_renewal_signed==='yes')&&!devNotes.length){
      const isMer=!!(nasach&&nasach.is_nasach_merukhaz);
      if(isMer){
        urFlags.push('הסכם/מו"מ להתחדשות עירונית מאוזכר ברקע, אך בנסח <b>המרוכז</b> שלפנינו לא נמצאה הערת אזהרה לטובת יזם. <b>הנסח הופק ב-'+(nasach&&nasach.nasach_date?nasach.nasach_date:'תאריך לא ידוע')+' ואינו עדכני</b> — ייתכן שמאז נחתם הסכם התחדשות ונרשמה הערת יזם על שם בעלי הזכויות. על שני הצדדים לבדוק את קיום הערת היזם <b>בנסח עדכני</b>.');
        push({t:'הפקת נסח מרוכז עדכני ובדיקת הערת יזם: הנסח הקיים אינו עדכני — ודא אם נרשמה הערת אזהרה לטובת יזם על שם בעלי הזכויות (ייתכן שנחתם הסכם התחדשות לאחר תאריך הנסח)',who:'ב"כ הקונה / ב"כ המוכר',critical:true,dateIso:'',dateText:'בהקדם — לפני המשך העסקה',dep:null});
      } else {
        urFlags.push('הסכם התחדשות עירונית מאוזכר אך לא נמצאה הערת אזהרה לטובת היזם על שם בעלי הזכויות בנסח הפרטני. ייתכן שההערה רשומה בתת-חלקה הייעודית להתחדשות — הנראית רק בנסח מרוכז. יש להפיק נסח מרוכז ולוודא.');
        push({t:'הפקת נסח מרוכז ובדיקה: ודא שהערת היזם רשומה על שם בעלי הזכויות (ייתכן בתת-חלקה הייעודית להתחדשות)',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'בהקדם',dep:null});
      }
    }
    // מספר יזמים
    if(devNames.length>1){ urFlags.push('זוהו מספר יזמים בהערות האזהרה ('+devNames.join(' · ')+') — יש להתייחס לכולם.'); }
    // ── מנגנון הסכמת בעלים/חוכרים (רמ"י, חברה משכנת, גוש-חלקה, עירייה, מנהל אזרחי, כונס נכסים) ──
    const bodies=ctx.consentBodies(); const receivers=ctx.receiverNotes(); const preConsent=ctx.preConsentNotes(); const bmC=A.buyer_mortgage==='yes';
    const consentIso=deliveryIso?addDays(deliveryIso,-30):(anchorIso||''); const consentWhen='כחודש לפני המסירה — נדרש לרישום המכר'+(bmC?' והמשכנתא':'')+' בטאבו';
    const consentDep='ב"כ הקונה יהיה בידיעה ויעקוב אחר קבלת ההסכמה';
    bodies.forEach(b=>{ push({t:'קבלת הסכמת '+b+' לעסקת המכר'+(bmC?' ולמשכנתא':'')+' — בהתאם לטפסים ולנהלים של הגוף',who:'מוכר / ב"כ המוכר',critical:true,dateIso:consentIso,dateText:consentWhen,dep:consentDep}); });
    receivers.forEach(r=>{ push({t:'קבלת הסכמת כונס הנכסים לעסקת המכר'+(bmC?' ולמשכנתא':'')+(r.in_favor_of?(' ('+r.in_favor_of+')'):''),who:'מוכר / ב"כ המוכר',critical:true,dateIso:consentIso,dateText:'כחודש לפני המסירה — נדרש לרישום בטאבו (הכונס מופיע כהערה, לא כבעלים)',dep:consentDep}); });
    if((bodies.length||receivers.length)&&preConsent.length){ consentFlags.push('זוהתה הערת הסכמה-מראש ('+Array.from(new Set(preConsent.map(w=>w.type||w.detail))).join(' · ')+') — ייתכן שאין צורך בהסכמת הגוף וניתן לרשום ישירות בטאבו. <b>ברירת המחדל היא שנדרשת הסכמה</b> — יש לוודא מול הגוף.'); }
    // ── הערת "העברה לזרים" — מידע קבוע, לא משימת טיפול/ניקוי של המוכר ולא תנאי להסכמת רמ"י כללית ──
    if(ctx.foreignTransferWarnings().length){
      consentFlags.push('בנסח רשומה הערת "העברה לזרים" לטובת מדינת ישראל (סעיף 4יט לחוק רשות מקרקעי ישראל תש"ך-1960) — הערה כללית וקבועה, <b>אינה נמחקת ואינה טעונה טיפול/ניקוי מצד המוכר</b>, ואינה מהווה כשלעצמה בעלות/חכירה מהמדינה. היא רלוונטית רק אם הרוכש בפועל זר — ואז ייתכן שהטאבו ידרוש אישור רמ"י להשלמת הרישום; מומלץ לברר זאת מול פקיד הטאבו בעת הגשת שטר המכר אם הרוכש זר.'+(A.foreign_transfer_ack==='no'?' <b>סומן שהלקוח לא ידע על ההערה</b> — יש להביא זאת לידיעתו.':''));
    }
    // ── חברה משכנת: בעסקה זו אין רישום בטאבו — המשימות נגזרות מנוהל החברה ──
    if(chevra){
      const cbm=A.buyer_mortgage==='yes';
      // מיד עם העסקה
      push({t:'הגשת מסמכי הנוהל לחברה המשכנת — לכל הפחות: הנוהל והמסמכים מוכנים בעותקים מתאימים, ובקשה לרישום הערת אזהרה לטובת הקונה חתומה ומאומתת לפי דרישות החתימה של החברה',who:'קונה / מוכר (הצד המרכז)',critical:true,dateIso:anchorIso||'',dateText:'מיד עם העסקה',dep:'בעסקת חברה משכנת הערת האזהרה נרשמת בספרי החברה — לא בטאבו'});
      push({t:'ייפוי כח נוטריוני בלתי חוזר (קונים), 2 עותקים, בנוסח החברה המשכנת',who:'קונה / מוכר (הצד המרכז)',critical:true,dateIso:anchorIso||'',dateText:'בסמוך ליום העסקה',dep:null});
      if(hasSellerMort){ push({t:'קבלת הסכמת בנק המוכר לרישום הערת אזהרה — במקור — והעברתה לחברה המשכנת במקור בהקדם',who:'מוכר / ב"כ המוכר',critical:true,dateIso:anchorIso||'',dateText:'בהקדם — במקור',dep:null}); }
      // משימה מסיימת לשלב רישום הע"א הראשוני (התוצר הסופי)
      push({t:'הפקת אישור זכויות עדכני מהחברה המשכנת — המאמת שהערת האזהרה נרשמה על שם הקונה/קונים ושתיאור העסקה מופיע בו (התוצר הסופי של שלב רישום הע"א: בקשה חתומה ע"י החברה והמוכר + אישור זכויות עם שם הקונה והעסקה)',who:'ב"כ הקונה',critical:true,dateIso:anchorIso?addDays(anchorIso,7):'',dateText:'בתום שלב רישום הערת האזהרה',dep:'תלוי בהגשת מסמכי הנוהל ובחתימת החברה'});
      // זיהוי הדירה: תיאורי רק כשאין תת-חלקה (חברה משכנת ללא בית משותף)
      if(!hasTat){ consentFlags.push('עסקת חברה משכנת ללא בית משותף (אין תת-חלקה): יש לכלול בהערת האזהרה (כולל הע"א של המשכנתא) ובאישור הזכויות זיהוי תיאורי של הדירה — קומה, מס׳ דירה, מס׳ בניין וכיווני אוויר — לצורך זיהוי.'); }
      else { consentFlags.push('עסקת חברה משכנת עם בית משותף — היחידה רשומה על תת-חלקה (ניתנת לזיהוי, סיכון נמוך יותר); כל הבדיקות והרישומים מתבצעים ברמת תת-החלקה.'); }
      // A1 — רישום משכון על שם המוכר (רק אם ההסכם דורש זאת במפורש)
      if(agr.seller_pledge_required===true){ push({t:'רישום משכון על שם המוכר (לפי דרישת ההסכם) — כל עוד לא נרשמה הערת אזהרה לטובת הקונה במיידי',who:'ב"כ הקונה',critical:true,dateIso:anchorIso||'',dateText:'בסמוך ליום העסקה',dep:null}); }
      // A2 — לעבור על מלוא מסמכי הנוהל ולוודא דרישות החברה
      push({t:'מעבר על מלוא המסמכים שבנוהל לעניין רישום בקשת הערת האזהרה, ווידוא דרישות החברה המשכנת (ייתכנו מסמכים נוספים, למשל ייפוי כח בלתי חוזר נוטריוני — לחתימה מול נוטריון)',who:'קונה / מוכר (הצד המרכז)',critical:true,dateIso:anchorIso||'',dateText:'בסמוך ליום העסקה',dep:null});
      // בדיקת זמן: התהליך איטי — נדרש יותר משבועיים עד התשלום הראשון
      const fp=(agr.payments&&agr.payments[0]&&agr.payments[0].iso)||''; if(anchorIso&&fp){ const dd=Math.round((new Date(fp+'T00:00:00Z')-new Date(anchorIso+'T00:00:00Z'))/86400000); if(dd<14){ consentFlags.push('עסקת חברה משכנת: רישום הערת האזהרה והעברת התשלום הראשון עשויים לקחת זמן. בהסכם נקבעו רק '+dd+' ימים מיום העסקה עד התשלום הראשון — מומלץ יותר משבועיים. יש לבדוק שלוח הזמנים ריאלי.'); } }
      if(cbm){
        const bmd=A.buyer_mortgage_date||''; const cmIso=bmd?addDays(bmd,-45):''; const cmWhen=bmd?('כ-45 יום לפני נטילת המשכנתא ('+isoToDisplay(bmd)+')'):'~45 יום לפני המשכנתא — התהליך בחברה משכנת איטי';
        push({t:'פניית הבנק המממן לחברה המשכנת לקבלת התחייבות לרישום משכנתא + כתב התחייבות מהחברה (בנוסח החברה)',who:'קונה / בנק הקונה',critical:false,dateIso:cmIso,dateText:cmWhen,dep:null});
        // 1. מכתב החרגה — בנק מלווה של הפרויקט (מופיע בנסח המרוכז)
        push({t:'בדיקת בנק מלווה של הפרויקט (בנסח המרוכז) — אם רשום, הפקת מכתב החרגה להוצאת היחידה מהשעבוד הכללי',who:'מוכר / ב"כ המוכר',critical:true,dateIso:cmIso,dateText:cmWhen,dep:null});
        // 2. הסכמת בנק המשכנתאות של המוכר לרישום הע"א לטובת בנק הקונה — במקור
        if(hasSellerMort){ push({t:'קבלת הסכמת בנק המשכנתאות של המוכר לרישום הערת אזהרה לטובת בנק המשכנתאות של הקונה — במקור',who:'ב"כ הקונה (פונה לב"כ המוכר)',critical:true,dateIso:cmIso,dateText:cmWhen,dep:null}); }
        // 3. בקשת הע"א לטובת בנק הקונה — החתמת המוכר ואז העברה לחברה להחתמתה
        push({t:'בקשה לרישום הערת אזהרה לטובת בנק המשכנתאות של הקונה — להחתמת המוכר, ולהעברה לחברה המשכנת להחתמתה; לכלול זיהוי תיאורי של הדירה (קומה/מס׳ דירה/בניין/כיווני אוויר)',who:'ב"כ הקונה / הצד המרכז',critical:true,dateIso:cmIso,dateText:cmWhen,dep:null});
        // 4. אישור זכויות לאחר הסכמת החברה ורישום הע"א של המשכנתא על שם הקונה
        push({t:'הפקת אישור זכויות לאחר הסכמת החברה ורישום הערת האזהרה של המשכנתא על שם הקונה',who:'ב"כ הקונה',critical:true,dateIso:bmd?addDays(bmd,-7):'',dateText:'לאחר רישום הע"א של המשכנתא',dep:'תלוי בהסכמת החברה ובחתימתה'});
      }
      // סביב המסירה / גמר התשלומים
      push({t:'מסמכי העברה בנוסח החברה — חתומים ומאומתים = העברת הזכויות בספרי החברה המשכנת',who:'קונה / מוכר',critical:true,dateIso:deliveryIso||'',dateText:'בגמר התשלומים והמסירה',dep:null});
      push({t:'אישור זכויות עדכני מהחברה המשכנת לאחר ההעברה (כרוך בדמי טיפול)',who:'קונה / מוכר',critical:false,dateIso:deliveryIso?addDays(deliveryIso,7):'',dateText:'לאחר העברת הזכויות',dep:null});
      push({t:'אישור ועד בית / חברת ניהול על העדר חובות',who:'מוכר',critical:false,dateIso:deliveryIso?addDays(deliveryIso,-7):'',dateText:'סמוך למסירה',dep:null});
      push({t:'בקשה למחיקת הערת האזהרה + ייפוי כח (מוכר) לביטולה, בנוסח החברה',who:'מוכר / ב"כ המוכר',critical:true,dateIso:'',dateText:'בגמר התשלומים',dep:'האנלוג למחיקת הערה/משכנתה — בספרי החברה'});
      push({t:'התחייבות עוה"ד המטפלים לבטל את הערת האזהרה לקונה בגמר התשלומים',who:'עו"ד הצדדים',critical:false,dateIso:'',dateText:'בגמר התשלומים',dep:null});
      // ── מחיקת משכנתת המוכר בחברה משכנת (תהליך ~45 יום) ──
      if(hasSellerMort){
        const poIso=sm0.payoff_deadline_iso||A.seller_mortgage_payoff||'';
        push({t:'בקשת הסכמת בנק המוכר למחיקת הערת המשכנתה (באישור הזכויות) — מופקת במקור תוך ימים/שבועות — והעברתה לחברה המשכנת',who:'מוכר / ב"כ המוכר',critical:true,dateIso:poIso?addDays(poIso,3):'',dateText:'לאחר סילוק המשכנתה — במקור',dep:'תלוי בסילוק המשכנתה'});
        push({t:'הפקת אישור זכויות נקי (ללא משכנתא) מהחברה המשכנת',who:'חברה משכנת / מוכר',critical:true,dateIso:poIso?addDays(poIso,45):'',dateText:'תהליך המחיקה אורך כ-45 יום מהסילוק',dep:'תלוי בהסכמת הבנק'});
        push({t:'מסירת שלושת המסמכים הנקיים לקונה: (1) אישור זכויות נקי, (2) נסח טאבו נקי, (3) דוח עיון נקי — כולם ללא משכנתת המוכר/ים',who:'מוכר → קונה',critical:true,dateIso:_lastPayIso?addDays(_lastPayIso,-3):'',dateText:'לפני התשלום האחרון',dep:'תלוי בהפקת אישור הזכויות הנקי'});
        // דגל מהותי: לוח זמנים לא ריאלי / לא מצוין בהסכם
        const delDays=parseNum((sm0.deletion_days!=null?sm0.deletion_days:''));
        if(sm0.deletion_days!=null && delDays>0 && delDays<45){ (dateFlags).push('בחברה משכנת תהליך מחיקת המשכנתה אורך כ-45 יום, אך ההסכם מחייב את המוכר למחוק תוך '+delDays+' ימים מהסילוק — לוח זמנים לא ריאלי. יש לתקן/להסדיר.'); }
        else if(sm0.deletion_days==null){ consentFlags.push('<b>דגל מהותי:</b> מחיקת משכנתת המוכר בחברה משכנת אורכת כ-45 יום וכרוכה בהמצאת שלושת המסמכים הנקיים (אישור זכויות / נסח / דוח עיון) — ואינה מוסדרת בהסכם. יש להסדיר בהסכם.'); }
      }
      // ── סיום העסקה — מסמכים שעל הקונה לספק לחברה המשכנת (B1–B5) ──
      const _lpIso=_lastPayIso||deliveryIso;
      push({t:'קבלת מלוא מסמכי העסקה מב"כ המוכר — הרשימה שבהסכם (לאחר התשלום האחרון)',who:'ב"כ הקונה',critical:true,dateIso:deliveryIso||'',dateText:'במעמד המסירה / עם התשלום האחרון',dep:null});
      push({t:'B1 · מסירת כל אישורי המיסים של שרשרת הזכויות לחברה המשכנת — אישורי עירייה, מס שבח ומס רכישה של כל העסקאות בשרשרת',who:'קונה / מוכר',critical:true,dateIso:_lpIso?addDays(_lpIso,-3):'',dateText:'לקראת סיום העסקה',dep:null});
      push({t:'B2 · מחיקת כל הערות האזהרה הקיימות על שם בעלי הזכויות הקודמים (כולל המוכרים שעמם נחתם ההסכם) — באחריות המוכר; הקונה לוודא שבוצע',who:'מוכר / ב"כ המוכר',critical:true,dateIso:_lpIso?addDays(_lpIso,-3):'',dateText:'לקראת סיום העסקה',dep:null});
      if(hasSellerMort){ push({t:'B3 · מחיקת המשכון (ככל שקיים) על שם המוכר',who:'מוכר / ב"כ המוכר',critical:true,dateIso:_lpIso?addDays(_lpIso,-3):'',dateText:'לקראת סיום העסקה',dep:null}); }
      push({t:'B4 · המצאת ייפויי הכח הנדרשים בנוהל (חלקם ייפוי כח בלתי חוזר נוטריוני) — לפעול לטובת הקונה, ולמחיקת הערות האזהרה על שם הקונה ועל שם המוכר',who:'קונה / מוכר (לפי הנוהל)',critical:true,dateIso:_lpIso?addDays(_lpIso,-3):'',dateText:'לקראת סיום העסקה',dep:null});
      push({t:'B5 · לאחר העברת מלוא המסמכים — הפקת אישור זכויות עדכני על שם הקונה בלבד (ללא שם המוכר; עם/בלי המשכנתא לפי העסקה)',who:'חברה משכנת / ב"כ הקונה',critical:true,dateIso:deliveryIso?addDays(deliveryIso,7):'',dateText:'בתום העברת הזכויות',dep:'תלוי בהמצאת מלוא המסמכים'});
      // הערה: ייתכן שלא בוצעו בדיקות מקדמיות ולכן הנוהל לא זמין
      consentFlags.push('עסקת חברה משכנת: אם לא הועלה נוהל העברת הזכויות של החברה — המשימות לעיל מבוססות על המסמכים הסטנדריים. המשימות המדויקות (כולל אם הקונה לוקח משכנתא — הסכמת הבנק לרישום הע"א) נגזרות מנוהל החברה הספציפי; מומלץ להפיקו ולפעול לפיו.');
    }
    if(n&&A.nasach_critical_ack==='yes'){ (n.warnings||[]).filter(w=>/עיקול|תקנה 27|תקנה 29|צו הריסה|הערה אחרת/.test(String(w.type||''))).forEach(w=>{ push({t:'טיפול וסילוק: '+w.type+(w.detail?(' — '+w.detail):''),who:'עו"ד המוכר',critical:true,dateIso:anchorIso?addDays(anchorIso,7):'',dateText:'משבוע מיום העסקה ועד המסירה',dep:null}); }); }
    const del=agr.delivery||{}; push({t:'מסירת חזקה + העברת מלוא התמורה',who:'מוכר → קונה',critical:true,dateIso:pending?'':(del.date_iso||''),dateText:del.text||(del.date?('עד '+del.date):'לפי ההסכם'),dep:'תלוי בהשלמת התשלומים ובאישורי המסים',pending:pending});
    const hdocs=(agr.handover_documents||[]).filter(Boolean);
    push({t:'העברת מסמכי העסקה לב"כ הקונה (כנגד התשלום האחרון)'+(hdocs.length?(' — '+hdocs.join('; ')):''),who:'ב"כ המוכר',critical:true,dateIso:del.date_iso||'',dateText:'במעמד המסירה / עם התשלום האחרון',dep:'תלוי בתשלום האחרון ובמסירת החזקה'+(hdocs.length?'':' · רשימת המסמכים לפי ההסכם')});
    // ── שרשרת הסיום לרישום בטאבו — רק כשיש רישום מסוים (תת-חלקה/בית משותף), לא במושעא ולא בח"מ ללא בית משותף ──
    const registered=hasTat; const lease=ctx.isLease(); const deedName=lease?'שטר העברת שכירות':'שטר מכר';
    // ── חברת גוש-חלקה: העברת מניות בחברה + רישום זכויות החכירה על שם מקבל הזכויות ──
    if(ctx.isGushHelka()){
      push({t:'העברת מניות החברה (חברת גוש-חלקה) על שם הקונה — בהתאם לנהלי החברה; קבלת אישור/פרוטוקול החברה על ההעברה',who:'מוכר / ב"כ המוכר',critical:true,dateIso:deliveryIso?addDays(deliveryIso,7):'',dateText:'לאחר המסירה — הקונה מקבל את מסמכי העסקה ביום המסירה, ורק לאחריה מתבצעת העברת המניות',dep:'מבוצע לאחר מסירת מסמכי העסקה ביום המסירה'});
      push({t:'רישום העברת זכויות החכירה בטאבו על שם הקונה (במקביל להעברת המניות) — חתימה ואימות שטר העברת שכירות',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'לאחר אישור החברה והעברת המניות',dep:'תלוי באישור החברה ובהעברת המניות'});
      push({t:'קבלת אישור זכויות עדכני מהחברה על שם הקונה (לאחר העברת המניות ורישום הזכויות)',who:'ב"כ הקונה',critical:true,dateIso:deliveryIso?addDays(deliveryIso,21):'',dateText:'בתום ההעברה',dep:null});
    }
    // ── קניין נוסף בעסקה (חניה/מחסן) בתת-חלקה אחרת — בעיקר חניה בחכירה הדורשת שטר העברת זכויות נפרד ──
    (function(){
      const agrText=[(agr.meta&&agr.meta.property)||'',(agr.summary||[]).join(' '),(agr.flags||[]).join(' '),(agr.tax_notes||[]).join(' '),(agr.meta&&agr.meta.title)||''].join(' ');
      // טריגר מההסכם: שטר העברת חכירה / חניה בחכירה / "הבעלים והחוכרים" / קניין נוסף בתת-חלקה אחרת
      const mentionsLeaseTransfer=/שטר.{0,6}העברת.{0,6}(?:זכות|זכויות).{0,6}חכירה|העברת.{0,4}זכות.{0,4}החכירה|הבעלים והחוכרים/.test(agrText);
      const mentionsParking=/חני[הי]|מחסן/.test(agrText);
      if(!mentionsLeaseTransfer && !mentionsParking) return;
      // מסלול א': יש נסח מרוכז → שלוף את הבעלים הרשומים של תת-החלקה הנוספת (מההצלבה)
      const raw=(n&&n._raw)||null;
      const selTat=String((n&&n.tat_helka)||(typeof window!=='undefined'&&window._currentSelectedTat)||'').trim();
      let handledByMerukhaz=false;
      if(raw && (raw.all_owners||[]).length && selTat){
        const mAll=raw.all_owners||[]; const mChak=raw.all_chakira||raw.chakira||[];
        const norm=v=>String(v||'').replace(/[\s\-]/g,'').replace(/^0+/,'');
        const selNames=mAll.filter(o=>String(o.tat_helka||'').trim()===selTat).map(o=>(o.name||'').toLowerCase().trim())
          .concat(mChak.filter(c=>String(c.tat_helka||'').trim()===selTat).map(c=>(c.choker||c.name||'').toLowerCase().trim())).filter(Boolean);
        const selIds=mAll.filter(o=>String(o.tat_helka||'').trim()===selTat).map(o=>norm(o.id))
          .concat(mChak.filter(c=>String(c.tat_helka||'').trim()===selTat).map(c=>norm(c.id))).filter(Boolean);
        // אתר את תת-החלקה הנוספת שבה המוכרים מופיעים כחוכרים (החניה בחכירה)
        const otherLeaseTats={};
        mChak.forEach(c=>{ const t=String(c.tat_helka||'').trim(); if(!t||t===selTat)return;
          const nm=(c.choker||c.name||'').toLowerCase().trim(); const cid=norm(c.id);
          const hit=selNames.some(sn=>sn&&nm&&(sn===nm||sn.includes(nm)||nm.includes(sn)))||(cid&&selIds.includes(cid));
          if(hit){ if(!otherLeaseTats[t])otherLeaseTats[t]={lessees:[],owners:[]}; if(otherLeaseTats[t].lessees.indexOf(c.choker||c.name)<0)otherLeaseTats[t].lessees.push(c.choker||c.name); } });
        Object.keys(otherLeaseTats).forEach(t=>{
          // הבעלים הרשומים של תת-החלקה הזו (בעלי הקרקע שחתימתם נדרשת)
          otherLeaseTats[t].owners=mAll.filter(o=>String(o.tat_helka||'').trim()===t).map(o=>(o.name||'')+(o.id?(' (ת.ז '+o.id+')'):''));
        });
        const leaseTatKeys=Object.keys(otherLeaseTats);
        if(leaseTatKeys.length){
          handledByMerukhaz=true;
          leaseTatKeys.forEach(t=>{
            const inf=otherLeaseTats[t];
            const ownersTxt=inf.owners.length?inf.owners.join(' · '):'הבעלים הרשומים של תת-חלקה '+t+' (לזהות בנסח)';
            const lesseesTxt=inf.lessees.join(' · ');
            // משימת השטר הנפרד + הסכמה כפולה
            push({t:'שטר העברת זכות החכירה (קניין נוסף — תת-חלקה '+t+'): החתמת <b>הבעלים הרשומים</b> ('+ownersTxt+') <b>וגם החוכרים-מוכרים</b> ('+lesseesTxt+') — שטר נפרד משטר המכר של הדירה',who:'מוכר / ב"כ המוכר',critical:true,dateIso:deliveryIso?addDays(deliveryIso,-30):'',dateText:'לפני ההגשה לטאבו — חתימת הבעלים הרשום היא התחייבות יסודית של המוכר',dep:'ב"כ הקונה בידיעה ובמעקב'});
            push({t:'אימות והגשת שטר העברת זכות החכירה (תת-חלקה '+t+') לטאבו — בנפרד משטר המכר של הדירה',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'יחד עם הגשת שטר המכר של הדירה',dep:'תלוי בחתימת הבעלים הרשומים והחוכרים'});
            crossTatFlags.push('העסקה כוללת קניין נוסף בחכירה בתת-חלקה '+t+' (חניה/מחסן). העברתו נעשית ב<b>שטר העברת זכות חכירה נפרד</b>, החתום ע"י <b>הבעלים הרשומים</b> ('+(inf.owners.join(' · ')||'לזהות בנסח')+') <b>וגם החוכרים-מוכרים</b> ('+lesseesTxt+').');
          });
        }
      }
      // מסלול ב': רק נסח פרטני (או שאין מרוכז) → משימה+שאלה למשתמש; לבדיקת הקונה
      if(!handledByMerukhaz){
        push({t:'⚠️ ההסכם מזכיר קניין נוסף (חניה/מחסן) שייתכן שמוחזק בחכירה בתת-חלקה אחרת, אך לא הועלה נסח מרוכז לאימות. <b>לבדיקת הקונה:</b> לוודא מול ההסכם והנסח המרוכז האם הקניין הנוסף כלול בעסקה, ואם כן — שהעברתו נעשית בשטר העברת זכות חכירה נפרד החתום ע"י הבעלים הרשומים והחוכרים. מומלץ להעלות נסח מרוכז להשלמת הבדיקה.',who:'ב"כ הקונה',critical:true,dateIso:anchorIso||'',dateText:'בהקדם — לבדיקת הקונה',dep:null});
        crossTatFlags.push('ההסכם מזכיר קניין נוסף (חניה/מחסן) שייתכן שמוחזק בחכירה בתת-חלקה אחרת, אך לא הועלה נסח מרוכז לאימות. <b>לבדיקת הקונה</b> — לוודא אם הקניין כלול בעסקה ומהו מנגנון העברתו. מומלץ להעלות נסח מרוכז.');
      }
    })();
    if(registered && !(chevra && !hasTat)){
      const bmT=A.buyer_mortgage==='yes'; const bmd2=A.buyer_mortgage_date||'';
      // שמירה בנאמנות ביום העסקה → העברה במסירה
      push({t:'שמירת מסמכי העסקה בנאמנות ב"כ המוכר — ייפוי כח המוכרים, ייפוי כח למחיקת הערת אזהרה, ו'+deedName,who:'ב"כ המוכר',critical:true,dateIso:anchorIso||'',dateText:'מיום העסקה ועד המסירה',dep:null});
      // החתמה ואימות השטר
      push({t:'החתמת '+deedName+' (מוכר + קונה) ואימותו — נדרש להגשה לטאבו',who:'עו"ד הצדדים',critical:true,dateIso:deliveryIso||'',dateText:'לקראת ההגשה לטאבו',dep:null});
      // בעסקת חכירה — אישור המוסדות על השטר (אלא אם הערת הסכמה-מראש)
      if(lease){ const skip=ctx.preConsentNotes().length; push({t:'אישור המוסדות (רמ"י / הגוף הרלוונטי) על '+deedName+(skip?' — ייתכן שאין צורך עקב הערת הסכמה-מראש (יש לוודא)':''),who:'מוכר / ב"כ המוכר',critical:true,dateIso:deliveryIso?addDays(deliveryIso,-30):'',dateText:'לפני ההגשה לטאבו'+(skip?' (בכפוף לחריג ההערה)':''),dep:'ב"כ הקונה בידיעה ובמעקב'}); }
      // אם משכנתא — הזמנת שטר משכנתא (מספר שבועות), חתימה ואימות
      if(bmT){ push({t:'בקשת בנק המשכנתאות של הקונה להזמנת שטר משכנתא — תהליך של מספר שבועות; עם קבלתו: חתימת הקונה ואימות ע"י עוה"ד שלו',who:'קונה / ב"כ הקונה',critical:true,dateIso:bmd2?addDays(bmd2,-21):'',dateText:'מספר שבועות מראש — לפני ההגשה',dep:null}); }
      // הגשה מקוונת לטאבו עם אישורי המיסים
      push({t:'אימות '+deedName+(bmT?' ושטר המשכנתא':'')+' והגשתם במערכת המקוונת לטאבו — יחד עם אישור מס שבח, אישור מס רכישה, ואישור עירייה תקף ליום ההגשה',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'לאחר התשלום הסופי וקבלת מלוא מסמכי העסקה',dep:'תלוי בקבלת מסמכי העסקה ובאישורי המיסים'+(lease?' ובאישור המוסדות':'')});
      // משימת רישום סופי
      push({t:'רישום העסקה בטאבו — מחיקת שם המוכרים ורישום הקונים (התוצר הסופי)',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'לאחר ההגשה המקוונת',dep:'תלוי בהגשה התקינה'});
      // שנה מיום העסקה וטרם נרשם → אישור חיים + מכתב נלווה
      if(anchorIso){ push({t:'אם חלפה שנה מיום העסקה והזכויות טרם נרשמו: קבלת אישור הצדדים שהם בחיים ומשלוח מכתב נלווה לטאבו / רמ"י',who:'ב"כ הקונה',critical:false,dateIso:addDays(anchorIso,365),dateText:'שנה מיום העסקה (אם טרם נרשם)',dep:null}); }
    } else {
      push({t:'הגשת מסמכי העברת הזכויות ללשכת רישום המקרקעין',who:'ב"כ הקונה',critical:true,dateIso:'',dateText:'לאחר התשלום הסופי וקבלת מלוא מסמכי העסקה',dep:'תלוי בתשלום הסופי ובקבלת מסמכי העסקה מב"כ המוכר'});
    }
    // ── סכום לוח התשלומים מול תמורת העסקה (דגל אדום אם אינו תואם) ──
    const _total=parseNum(agr.meta&&agr.meta.price); const _paySum=(agr.payments||[]).reduce((s,p)=>s+parseNum(p.amount),0); let sumFlag=null, sumOk=null;
    if(_total&&_paySum){
      const signed=_paySum-_total; const diff=Math.abs(signed);
      if(diff>Math.max(_total*0.01,1000)){
        const dir=signed>0?'עודף':'חסר';
        const expl=signed>0
          ?'לוח התשלומים גבוה מתמורת העסקה — סכום עודף של '+diff.toLocaleString('he-IL')+' ₪. ייתכן תשלום כפול, רכיב שאינו חלק מהתמורה (כגון מע"מ/ריבית/הצמדה), או טעות. יש לבדוק.'
          :'לוח התשלומים נמוך מתמורת העסקה — חסרים '+diff.toLocaleString('he-IL')+' ₪. ייתכן תשלום שלא נכלל בלוח, יתרה שלא פורטה, או טעות. יש לבדוק לאן נעלם ההפרש.';
        sumFlag='🔴 <b>'+dir+' בלוח התשלומים</b> — סכום הלוח: '+_paySum.toLocaleString('he-IL')+' ₪ · תמורת העסקה: '+_total.toLocaleString('he-IL')+' ₪. '+expl;
      } else {
        sumOk='✓ לוח התשלומים תואם לתמורת העסקה ('+_total.toLocaleString('he-IL')+' ₪) — אין עודף או חסר.';
      }
    }
    // מיון כרונולוגי — כל משימה (כולל משימות המשכנתה) במקומה המדויק בלוח; משימות ללא מועד בסוף, בסדר ההוספה
    const _ord=x=>parseInt(String(x.id).replace('m',''),10)||0;
    ms.sort((a,b)=>{ const da=a.dateIso||'9999-99-99', db=b.dateIso||'9999-99-99'; return da<db?-1:(da>db?1:(_ord(a)-_ord(b))); });
    return { milestones: ms, anomalies, urFlags, consentFlags, crossTatFlags, dateFlags, sumFlag, sumOk, closingDate, deliveryDate, pending, pendingNote };
  }

  // ── STEP 5: build the .ics calendar export ──
  function icsStamp(){const d=new Date();return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())+'Z';}
  function nextDay(iso){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate());}
  function icsEsc(s){return String(s).replace(/\\/g,'\\\\').replace(/([,;])/g,'\\$1').replace(/\n/g,'\\n');}
  function buildICSCore(agreement, milestones, pending){
    const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DIGITALAW//לאחר עסקה//HE','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
    const addr=(agreement&&agreement.meta&&agreement.meta.property&&agreement.meta.property.address)||'העסקה';
    function ev(uid,iso,sum,desc,ad){L.push('BEGIN:VEVENT','UID:'+uid,'DTSTAMP:'+icsStamp(),'DTSTART;VALUE=DATE:'+iso.replace(/-/g,''),'DTEND;VALUE=DATE:'+nextDay(iso),'SUMMARY:'+icsEsc(sum),'DESCRIPTION:'+icsEsc(desc),'BEGIN:VALARM','TRIGGER:-P'+(ad||3)+'D','ACTION:DISPLAY','DESCRIPTION:'+icsEsc(sum),'END:VALARM','END:VEVENT');}
    function todo(uid,sum,desc){L.push('BEGIN:VTODO','UID:'+uid,'DTSTAMP:'+icsStamp(),'SUMMARY:'+icsEsc(sum),'DESCRIPTION:'+icsEsc(desc),'END:VTODO');}
    (agreement.payments||[]).forEach((p,i)=>{ if(p.iso&&!pending)ev('pay'+i+'@dl',p.iso,'תשלום בעסקת '+addr+': '+p.amount,(p.cond||'')+' · התראה שבוע מראש',7); });
    milestones.forEach((s,i)=>{ const desc='אחראי: '+s.who+(s.dep?(' · '+s.dep):''); if(s.deadlineReminder&&s.dateIso){ ev('cond'+i+'@dl',s.dateIso,'סיום תקופת התנאי המתלה — '+s.t,'נותרו 7 ימים לסיום התנאי המתלה בעסקה — יש להסדיר מול ב"כ הצד השני',7); } else if(s.dateIso&&!s.pending)ev('ms'+i+'@dl',s.dateIso,s.t,desc,s.t.indexOf('תשלום')>=0?7:3); else todo('ms'+i+'@dl',s.t,desc+(s.dateText?(' · מועד: '+s.dateText):'')); });
    L.push('END:VCALENDAR'); return L.join('\r\n');
  }
  return {
    pad, isoToDisplay, addDays, addMonths, le, parseNum,
    NASACH_SYS, AGR_SYS, PRECHECK_SYS,
    makeCtx,
    fundamentalMismatch,
    runValidationCore,
    buildQuestionsCore,
    buildMilestonesCore,
    buildICSCore
  };
});
