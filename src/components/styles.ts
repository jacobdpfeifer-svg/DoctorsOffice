// Fonts are self-hosted via @fontsource/* packages imported in main.tsx.
// @font-face declarations are injected into the document by Vite's CSS
// pipeline before this runtime <style> tag renders, so font-family references
// below resolve correctly without any @import here.
export const CSS = `
.lf{
  --ink:#16182B; --ink-soft:#3A3D55; --line:#E4E1D8; --line-2:#EEEBE3;
  --paper:#F4F2EC; --white:#FFFFFF; --cobalt:#2F49D1; --cobalt-ink:#1E2F8F;
  --jade:#15806B; --jade-soft:#E4F1EC; --clay:#B4421C; --mute:#8A8C9C;
  --shadow:0 1px 2px rgba(22,24,43,.06), 0 12px 30px -16px rgba(22,24,43,.28);
  font-family:'Inter',system-ui,sans-serif; color:var(--ink);
  background:
    radial-gradient(120% 90% at 12% -10%, #FBFAF6 0%, var(--paper) 46%, #ECE9E0 100%);
  min-height:100%; padding:18px; box-sizing:border-box;
  -webkit-font-smoothing:antialiased;
}
.lf *{ box-sizing:border-box; }
.lf input{ font-family:inherit; }

/* rail */
.lf-rail{
  display:flex; align-items:center; gap:18px; flex-wrap:wrap;
  background:var(--ink); color:#EDEDF4;
  border-radius:16px; padding:12px 16px; box-shadow:var(--shadow);
}
.lf-brand{ display:flex; align-items:center; gap:10px; }
.lf-mark{
  width:30px; height:30px; border-radius:9px; display:grid; place-items:center;
  background:linear-gradient(150deg,var(--cobalt),#5468ff); color:#fff;
}
.lf-brand-name{ font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:-.01em; font-size:16px; line-height:1; }
.lf-brand-sub{ font-size:10.5px; color:#9FA0B6; margin-top:3px; letter-spacing:.01em; }
.lf-office{ display:flex; align-items:center; gap:8px; font-size:11px; color:#9FA0B6; }
.lf-office span{ text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
.lf-office input{
  background:#23263E; border:1px solid #313452; color:#fff; border-radius:8px;
  padding:7px 10px; font-size:12.5px; min-width:190px; outline:none;
}
.lf-office input:focus{ border-color:var(--cobalt); }
.lf-controls{ display:flex; gap:6px; margin-left:auto; flex-wrap:wrap; }
.lf-ctl{
  font-family:inherit; font-size:11.5px; font-weight:600; color:#C9CADA;
  background:#23263E; border:1px solid #313452; border-radius:8px;
  padding:7px 11px; cursor:pointer; transition:all .15s; display:inline-flex; align-items:center; gap:5px;
}
.lf-ctl:hover{ color:#fff; border-color:#4A4E73; }
.lf-ctl[data-on="true"]{ background:var(--cobalt); border-color:var(--cobalt); color:#fff; }
.lf-ctl-ghost{ background:transparent; color:#8A8C9C; }
.lf-badge{
  font-size:10px; color:#8A8C9C; display:inline-flex; align-items:center; gap:4px;
  border:1px dashed #3A3D5A; padding:5px 8px; border-radius:7px; letter-spacing:.02em;
}

/* stage */
.lf-stage{
  display:grid; grid-template-columns:minmax(300px,360px) 1fr; gap:18px; margin-top:18px;
  align-items:start;
}
@media (max-width:760px){ .lf-stage{ grid-template-columns:1fr; } }
.lf-col-head{
  display:flex; align-items:center; gap:7px; font-size:11px; font-weight:600;
  text-transform:uppercase; letter-spacing:.08em; color:var(--mute); margin:0 0 10px 4px;
}

/* phone */
.lf-phone{
  position:relative; background:var(--ink); border-radius:38px; padding:11px;
  box-shadow:var(--shadow); margin:0 auto; width:340px; max-width:100%;
}
.lf-notch{ position:absolute; top:11px; left:50%; transform:translateX(-50%); width:120px; height:22px; background:var(--ink); border-radius:0 0 14px 14px; z-index:3; }
.lf-screen{
  background:var(--paper); border-radius:28px; overflow:hidden; height:580px;
  display:flex; flex-direction:column; position:relative;
}
.lf-ptop{
  display:flex; align-items:center; gap:7px; padding:30px 18px 12px;
  border-bottom:1px solid var(--line-2); background:var(--white);
}
.lf-ptop-dot{ width:8px; height:8px; border-radius:50%; background:var(--jade); box-shadow:0 0 0 3px var(--jade-soft); }
.lf-ptop-name{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:13.5px; letter-spacing:-.01em; }

.lf-pad{ padding:18px; flex:1; }
.lf-scroll{ overflow-y:auto; }
.lf-center{ display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:6px; }

/* tap */
.lf-tap{ position:relative; width:128px; height:128px; border:none; background:transparent; cursor:pointer; margin-bottom:6px; }
.lf-tap-core{
  position:absolute; inset:34px; border-radius:50%; display:grid; place-items:center;
  background:linear-gradient(150deg,var(--cobalt),#5468ff); color:#fff;
  box-shadow:0 10px 24px -8px rgba(47,73,209,.6); z-index:2;
}
.lf-tap-ring{ position:absolute; inset:18px; border-radius:50%; border:2px solid var(--cobalt); opacity:.5; animation:lf-pulse 2.2s ease-out infinite; }
.lf-tap-ring2{ inset:0; animation-delay:1.1s; }
@keyframes lf-pulse{ 0%{ transform:scale(.7); opacity:.6; } 100%{ transform:scale(1.15); opacity:0; } }
.lf-tap-label{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px; margin:8px 0 0; }
.lf-tap-sub{ font-size:12.5px; color:var(--ink-soft); max-width:230px; margin:0; line-height:1.45; }
.lf-link{
  margin-top:10px; background:none; border:none; color:var(--cobalt); font-family:inherit;
  font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;
}

/* fill */
.lf-h{ display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
.lf-h h3, .lf-h-solo{ font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:600; letter-spacing:-.015em; margin:0; }
.lf-h-solo{ margin-bottom:4px; }
.lf-mini{
  font-family:inherit; font-size:11px; font-weight:600; color:var(--cobalt);
  background:#EAEDFB; border:none; border-radius:7px; padding:6px 9px; cursor:pointer;
  display:inline-flex; align-items:center; gap:4px;
}
.lf-note{ font-size:12px; color:var(--ink-soft); line-height:1.5; margin:2px 0 14px; }
.lf-fs{ border:1px solid var(--line); border-radius:13px; padding:12px; margin:0 0 11px; background:var(--white); }
.lf-fs legend{
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
  color:var(--mute); padding:0 6px; display:inline-flex; align-items:center; gap:5px;
}
.lf-field{ display:block; margin-top:8px; }
.lf-field span{ display:block; font-size:11px; color:var(--ink-soft); margin-bottom:4px; font-weight:500; }
.lf-field input{
  width:100%; border:1px solid var(--line); border-radius:9px; padding:9px 11px;
  font-size:13px; color:var(--ink); background:var(--paper); outline:none; transition:border .15s;
}
.lf-field input:focus{ border-color:var(--cobalt); background:#fff; }

/* buttons */
.lf-primary{
  width:100%; border:none; border-radius:11px; padding:13px; cursor:pointer;
  background:var(--ink); color:#fff; font-family:'Space Grotesk',sans-serif; font-weight:600;
  font-size:14px; display:inline-flex; align-items:center; justify-content:center; gap:8px;
  transition:transform .12s, background .15s; margin-top:4px;
}
.lf-primary:hover{ background:#23263E; transform:translateY(-1px); }
.lf-primary:disabled{ opacity:.4; cursor:not-allowed; transform:none; }
.lf-send{ background:var(--cobalt); }
.lf-send:hover{ background:var(--cobalt-ink); }
.lf-secondary{
  border:1px solid var(--line); background:var(--white); color:var(--ink);
  border-radius:11px; padding:13px 16px; cursor:pointer; font-family:'Space Grotesk',sans-serif;
  font-weight:600; font-size:14px; display:inline-flex; align-items:center; justify-content:center; gap:7px;
}
.lf-secondary:hover{ border-color:var(--ink-soft); }
.lf-actions{ display:flex; gap:9px; margin-top:14px; }
.lf-actions .lf-primary{ flex:1; margin-top:0; }

/* welcome + pass */
.lf-welcome{
  display:flex; align-items:center; gap:7px; background:var(--jade-soft); color:var(--jade);
  border-radius:10px; padding:9px 12px; font-size:12.5px; font-weight:600; margin-bottom:14px;
}
.lf-pass{
  border-radius:16px; padding:16px; color:#fff; margin-bottom:16px; position:relative; overflow:hidden;
  background:linear-gradient(135deg,#1B1E36 0%,#2A2F66 58%,#33409B 100%);
  box-shadow:0 14px 30px -14px rgba(30,47,143,.7);
}
.lf-pass::after{ content:""; position:absolute; right:-30px; top:-30px; width:120px; height:120px; border-radius:50%; background:rgba(255,255,255,.07); }
.lf-pass-top{ display:flex; align-items:center; justify-content:space-between; color:#B9C0F0; }
.lf-pass-kind{ font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.18em; }
.lf-pass-name{ font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:600; margin-top:18px; letter-spacing:-.01em; }
.lf-pass-meta{ display:flex; gap:14px; margin-top:6px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:#C7CCF2; }
.lf-pass-foot{ display:flex; align-items:center; gap:5px; margin-top:14px; font-size:10.5px; color:#9CA3E0; }

/* summary */
.lf-summary{ border:1px solid var(--line); border-radius:13px; background:var(--white); overflow:hidden; }
.lf-sum-row{ display:flex; gap:11px; padding:11px 13px; border-bottom:1px solid var(--line-2); color:var(--ink-soft); }
.lf-sum-row:last-child{ border-bottom:none; }
.lf-sum-row > svg{ margin-top:2px; flex-shrink:0; color:var(--cobalt); }
.lf-sum-label{ font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--mute); font-weight:600; }
.lf-sum-val{ font-size:12.5px; color:var(--ink); margin-top:2px; line-height:1.4; }

/* consent */
.lf-consent{ display:flex; flex-direction:column; gap:7px; margin:4px 0 12px; }
.lf-ctoggle{
  display:flex; align-items:center; justify-content:space-between; width:100%;
  border:1px solid var(--line); background:var(--white); border-radius:11px; padding:12px 13px;
  cursor:pointer; font-family:inherit; transition:border .15s, background .15s;
}
.lf-ctoggle[data-on="true"]{ border-color:#C4CCF4; background:#F7F8FE; }
.lf-ctoggle:disabled{ cursor:default; }
.lf-ctoggle[data-locked="true"]{ opacity:1; }
.lf-ctoggle-l{ display:flex; align-items:center; gap:9px; font-size:13px; font-weight:500; color:var(--ink); }
.lf-ctoggle-l svg{ color:var(--cobalt); }
.lf-switch{ width:38px; height:22px; border-radius:11px; background:#D9D7CE; position:relative; transition:background .18s; flex-shrink:0; }
.lf-switch[data-on="true"]{ background:var(--cobalt); }
.lf-knob{ position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:transform .18s; }
.lf-switch[data-on="true"] .lf-knob{ transform:translateX(16px); }
.lf-priv{ display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ink-soft); background:var(--line-2); border-radius:9px; padding:9px 11px; }

/* done */
.lf-done-ring{
  width:78px; height:78px; border-radius:50%; display:grid; place-items:center;
  background:var(--jade-soft); color:var(--jade); margin-bottom:6px;
  animation:lf-pop .4s cubic-bezier(.2,1.3,.5,1);
}
.lf-done-ring.is-sending{ background:#EAEDFB; color:var(--cobalt); animation:none; }
@keyframes lf-pop{ 0%{ transform:scale(.4); opacity:0; } 100%{ transform:scale(1); opacity:1; } }
.lf-spin{ width:26px; height:26px; border-radius:50%; border:3px solid #C4CCF4; border-top-color:var(--cobalt); animation:lf-rot .7s linear infinite; }
@keyframes lf-rot{ to{ transform:rotate(360deg); } }
.lf-done-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:18px; margin:6px 0 0; }
.lf-done-sub{ font-size:12.5px; color:var(--ink-soft); max-width:240px; margin:2px 0 0; line-height:1.45; }
.lf-done-pill{ display:inline-flex; align-items:center; gap:6px; margin-top:14px; font-size:11.5px; font-weight:600; color:var(--jade); background:var(--jade-soft); padding:7px 12px; border-radius:20px; }

/* console */
.lf-console{
  background:var(--white); border:1px solid var(--line); border-radius:20px;
  padding:14px; min-height:580px; max-height:640px; overflow-y:auto; box-shadow:var(--shadow);
}
.lf-empty{ display:flex; flex-direction:column; align-items:center; text-align:center; padding:80px 28px; gap:6px; }
.lf-empty-ring{ width:54px; height:54px; border-radius:50%; display:grid; place-items:center; background:var(--paper); color:var(--mute); border:1px dashed var(--line); }
.lf-empty-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px; margin:8px 0 0; }
.lf-empty-body{ font-size:12.5px; color:var(--ink-soft); max-width:320px; line-height:1.55; margin:0; }

.lf-packet{ border:1px solid var(--line); border-radius:15px; padding:14px; margin-bottom:12px; background:var(--white); }
.lf-land{ animation:lf-land .5s cubic-bezier(.2,.9,.3,1); }
@keyframes lf-land{ 0%{ transform:translateY(-12px); opacity:0; box-shadow:0 0 0 3px rgba(47,73,209,.35); } 100%{ transform:translateY(0); opacity:1; box-shadow:0 0 0 0 transparent; } }
.lf-packet-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
.lf-packet-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:15px; }
.lf-packet-time{ font-size:11px; color:var(--clay); margin-top:3px; font-weight:500; }
.lf-import{
  font-family:inherit; font-size:11.5px; font-weight:600; color:#fff; background:var(--ink);
  border:none; border-radius:8px; padding:8px 12px; cursor:pointer; white-space:nowrap; transition:background .15s;
}
.lf-import:hover{ background:#23263E; }
.lf-imported{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; color:var(--jade); background:var(--jade-soft); padding:7px 11px; border-radius:8px; white-space:nowrap; }

.lf-grp{ margin-bottom:11px; }
.lf-grp-h{ display:flex; align-items:center; gap:6px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.07em; color:var(--mute); margin-bottom:5px; }
.lf-grp-h svg{ color:var(--cobalt); }
.lf-row{ display:grid; grid-template-columns:118px 1fr auto; align-items:center; gap:10px; padding:7px 9px; border-radius:8px; }
.lf-row:hover{ background:var(--paper); }
.lf-row-l{ font-size:11px; color:var(--mute); }
.lf-row-v{ font-size:13px; color:var(--ink); font-weight:500; }
.lf-copy{ border:none; background:transparent; color:var(--mute); cursor:pointer; padding:4px; border-radius:6px; display:grid; place-items:center; transition:all .15s; }
.lf-copy:hover{ background:#EAEDFB; color:var(--cobalt); }
.lf-packet-foot{ display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--mute); margin-top:8px; padding-top:10px; border-top:1px solid var(--line-2); }

@media (prefers-reduced-motion: reduce){
  .lf *{ animation:none !important; transition:none !important; }
}
`;
