'use strict';
/**
 * update_v4.js — Reads the 4 new TSV data files (upd4), computes breakdowns
 * for sections 3b,3e,3f,3g,3h and 4b,4e,4f,4g,4h, and patches PathEDU_Analysis_upd.html.
 *
 * Run:  node update_v4.js
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'PathEDU_Analysis_upd.html');
const TS_DETAIL = path.join(__dirname, 'data_ts_detail_upd4.tsv');
const PS_DETAIL = path.join(__dirname, 'data_ps_detail_upd4.tsv');
const TS_SURVEY = path.join(__dirname, 'data_ts_survey_upd4.tsv');
const PS_SURVEY = path.join(__dirname, 'data_ps_survey_upd4.tsv');

/* ──────────── helpers ──────────── */

function readTsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trimEnd();
  const lines = raw.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
    return obj;
  });
}

function isMissing(v) {
  if (v === undefined || v === null) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'nan';
}

function num(v) {
  if (isMissing(v)) return null;
  const n = parseFloat(String(v).replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'N/A';
  return Number(n).toFixed(digits);
}

function round2(n) { return fmt(n, 2); }

/* ──────────── TS aggregation ──────────── */

function emptyTsAcc() {
  return { expert_cnt: 0, fs_cst_num: 0, fs_eng: 0,
    exec_fs_tnps_num: 0, exec_fs_tnps_denom: 0,
    ttla_handle_min: 0, ttla_handle_cnt: 0,
    conv_num: 0, conv_denom: 0 };
}

function addTsRow(acc, r) {
  const ex = num(r.expert_cnt); if (ex !== null) acc.expert_cnt += ex;
  const cn = num(r.fs_cst_num), fe = num(r.fs_eng);
  if (cn !== null && fe !== null) { acc.fs_cst_num += cn; acc.fs_eng += fe; }
  const fn = num(r.exec_fs_tnps_num), fd = num(r.exec_fs_tnps_denom);
  if (fn !== null && fd !== null) { acc.exec_fs_tnps_num += fn; acc.exec_fs_tnps_denom += fd; }
  const tm = num(r.ttla_handle_min), tc = num(r.ttla_handle_cnt);
  if (tm !== null && tc !== null && tc > 0) { acc.ttla_handle_min += tm; acc.ttla_handle_cnt += tc; }
  const cvn = num(r.conv_num), cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) { acc.conv_num += cvn; acc.conv_denom += cvd; }
}

function tsMetrics(a) {
  return {
    cst: a.fs_eng > 0 ? a.fs_cst_num / a.fs_eng : null,
    fsTnps: a.exec_fs_tnps_denom > 0 ? (a.exec_fs_tnps_num / a.exec_fs_tnps_denom) * 100 : null,
    ttlaAht: a.ttla_handle_cnt > 0 ? a.ttla_handle_min / a.ttla_handle_cnt : null,
    conv: a.conv_denom > 0 ? (a.conv_num / a.conv_denom) * 100 : null,
  };
}

function aggregateTs(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = isMissing(r[field]) ? '(Unknown)' : r[field];
    if (!map.has(key)) map.set(key, emptyTsAcc());
    addTsRow(map.get(key), r);
  }
  return [...map.entries()].map(([label, acc]) => {
    const m = tsMetrics(acc);
    return { label, experts: Math.round(acc.expert_cnt), cst: m.cst, fsTnps: m.fsTnps, conv: m.conv, ttlaAht: m.ttlaAht };
  }).sort((a, b) => b.experts - a.experts);
}

/* ──────────── PS aggregation ──────────── */

function emptyPsAcc() {
  return { expert_cnt: 0, ps_handle_min: 0, ps_handle_cnt: 0, ps_tnps_num: 0, ps_tnps_denom: 0 };
}

function addPsRow(acc, r) {
  const ex = num(r.expert_cnt); if (ex !== null) acc.expert_cnt += ex;
  const hm = num(r.ps_handle_min), hc = num(r.ps_handle_cnt);
  if (hm !== null && hc !== null) { acc.ps_handle_min += hm; acc.ps_handle_cnt += hc; }
  const tn = num(r.ps_tnps_num), td = num(r.ps_tnps_denom);
  if (tn !== null && td !== null) { acc.ps_tnps_num += tn; acc.ps_tnps_denom += td; }
}

function psMetrics(a) {
  return {
    aht: a.ps_handle_cnt > 0 ? a.ps_handle_min / a.ps_handle_cnt : null,
    tnps: a.ps_tnps_denom > 0 ? (a.ps_tnps_num / a.ps_tnps_denom) * 100 : null,
  };
}

function aggregatePs(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = isMissing(r[field]) ? '(Unknown)' : r[field];
    if (!map.has(key)) map.set(key, emptyPsAcc());
    addPsRow(map.get(key), r);
  }
  return [...map.entries()].map(([label, acc]) => {
    const m = psMetrics(acc);
    return { label, experts: Math.round(acc.expert_cnt), aht: m.aht, tnps: m.tnps };
  }).sort((a, b) => b.experts - a.experts);
}

/* ──────────── Survey normalization ──────────── */

function normalizeQ1(s) {
  const low = String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!low || low === 'null' || low === 'nan') return null;
  if (low.includes('build my resume') && (low.includes('skill') || low.includes('/ skill'))) return 'Build my resume/skills';
  if (low.includes('gain experience') && low.includes('future career')) return 'Gain experience relevant to my future career';
  if (low.includes('earn income') && low.includes('school')) return 'Earn income while in school';
  if (low.includes('flexible work') && low.includes('schedule')) return 'Flexible work that fits my schedule';
  return null;
}

function normalizeQ2(s) {
  const low = String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!low || low === 'null' || low === 'nan') return null;
  if (low.includes('mix') && low.includes('income') && (low.includes('career building') || low.includes('career-building'))) return 'A mix of income and career building';
  if (low.includes('mostly') && (low.includes('career-building') || low.includes('career building')) && low.includes('opportunity')) return 'Mostly a career-building opportunity';
  if (low.includes('mostly') && low.includes('job') && low.includes('earn money')) return 'Mostly a job to earn money';
  return null;
}

function normalizeQ3(s) {
  const low = String(s).trim().toLowerCase();
  if (!low || low === 'null' || low === 'nan') return null;
  if (low === 'very relevant') return 'Very relevant';
  if (low === 'somewhat relevant') return 'Somewhat relevant';
  if (low === 'not relevant') return 'Not relevant';
  return null;
}

function filterSurveyRows(rows) {
  return rows.filter(r => {
    return normalizeQ1(r.q1) && normalizeQ2(r.q2) && normalizeQ3(r.q3);
  }).map(r => ({
    ...r,
    q1n: normalizeQ1(r.q1),
    q2n: normalizeQ2(r.q2),
    q3n: normalizeQ3(r.q3),
  }));
}

/* ──────────── TS Survey aggregation (different column names from detail) ──────────── */

function addTsSurveyRow(acc, r) {
  const ex = num(r.expert_cnt); if (ex !== null) acc.expert_cnt += ex;
  const cn = num(r.fs_cst_num), fe = num(r.fs_eng);
  if (cn !== null && fe !== null) { acc.fs_cst_num += cn; acc.fs_eng += fe; }
  // survey uses exec_fs_tnps_denom and exec_fs_basic_tnps_num (but we need total tnps_num)
  // Actually the survey columns use exec_fs_tnps_denom for denom, but the "num" is exec_fs_basic_tnps_num
  // Wait - checking the original compute_survey_upd3.js, it uses exec_fs_tnps_num and exec_fs_tnps_denom
  // The header says exec_fs_tnps_denom and exec_fs_basic_tnps_num
  // For tNPS calculation we need num/denom. The "basic_tnps_num" seems wrong for total tNPS.
  // Let's just use the denom as denom and look for any column that could be the numerator
  const fn = num(r.exec_fs_tnps_num) !== null ? num(r.exec_fs_tnps_num) : num(r.exec_fs_basic_tnps_num);
  const fd = num(r.exec_fs_tnps_denom);
  if (fn !== null && fd !== null) { acc.exec_fs_tnps_num += fn; acc.exec_fs_tnps_denom += fd; }
  // survey uses ttla_handle_min/ttla_handle_cnt for AHT
  const tm = num(r.ttla_handle_min), tc = num(r.ttla_handle_cnt);
  if (tm !== null && tc !== null && tc > 0) { acc.ttla_handle_min += tm; acc.ttla_handle_cnt += tc; }
  const cvn = num(r.conv_num), cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) { acc.conv_num += cvn; acc.conv_denom += cvd; }
}

function aggregateTsSurvey(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = r[field];
    if (!key) continue;
    if (!map.has(key)) map.set(key, emptyTsAcc());
    addTsSurveyRow(map.get(key), r);
  }
  return [...map.entries()].map(([label, acc]) => {
    const m = tsMetrics(acc);
    return { label, experts: Math.round(acc.expert_cnt), cst: m.cst, fsTnps: m.fsTnps, conv: m.conv, ttlaAht: m.ttlaAht };
  }).sort((a, b) => b.experts - a.experts);
}

/* ──────────── PS Survey aggregation ──────────── */

function aggregatePsSurvey(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = r[field];
    if (!key) continue;
    if (!map.has(key)) map.set(key, emptyPsAcc());
    addPsRow(map.get(key), r);
  }
  return [...map.entries()].map(([label, acc]) => {
    const m = psMetrics(acc);
    return { label, experts: Math.round(acc.expert_cnt), aht: m.aht, tnps: m.tnps };
  }).sort((a, b) => b.experts - a.experts);
}

/* ──────────── Key finding generators ──────────── */

function bestWorst(arr, key, higher = true) {
  const ok = arr.filter(r => r[key] !== null && Number.isFinite(r[key]));
  if (ok.length < 2) return null;
  ok.sort((a, b) => a[key] - b[key]);
  return { lo: ok[0], hi: ok[ok.length - 1] };
}

function tsKeyFinding(rows) {
  const parts = [];
  const v = bestWorst(rows, 'fsTnps', true);
  if (v) parts.push(`${v.hi.label} leads tNPS (${round2(v.hi.fsTnps)}); ${v.lo.label} trails (${round2(v.lo.fsTnps)}).`);
  const c = bestWorst(rows, 'cst', false);
  if (c) parts.push(`CST ranges ${round2(c.lo.cst)}–${round2(c.hi.cst)}.`);
  return parts.join(' ') || 'All groups perform similarly.';
}

function psKeyFinding(rows) {
  const parts = [];
  const v = bestWorst(rows, 'tnps', true);
  if (v) parts.push(`${v.hi.label} leads tNPS (${round2(v.hi.tnps)}); ${v.lo.label} trails (${round2(v.lo.tnps)}).`);
  const a = bestWorst(rows, 'aht', false);
  if (a) parts.push(`AHT ranges ${round2(a.lo.aht)}–${round2(a.hi.aht)} min.`);
  return parts.join(' ') || 'All groups perform similarly.';
}

function tsSurveyKeyFinding(rows) {
  const parts = [];
  const c = bestWorst(rows, 'cst', false);
  if (c) parts.push(`"${c.lo.label}" has lowest CST (${round2(c.lo.cst)}) vs "${c.hi.label}" (${round2(c.hi.cst)}).`);
  const v = bestWorst(rows, 'fsTnps', true);
  if (v && v.hi.label !== (c && c.lo.label)) parts.push(`"${v.hi.label}" leads tNPS (${round2(v.hi.fsTnps)}).`);
  const cv = bestWorst(rows, 'conv', true);
  if (cv) parts.push(`Conv% best: "${cv.hi.label}" (${round2(cv.hi.conv)}%).`);
  return parts.join(' ') || 'Insufficient data.';
}

function psSurveyKeyFinding(rows) {
  const parts = [];
  const a = bestWorst(rows, 'aht', false);
  if (a) parts.push(`"${a.lo.label}" has lowest AHT (${round2(a.lo.aht)}) vs "${a.hi.label}" (${round2(a.hi.aht)}).`);
  const v = bestWorst(rows, 'tnps', true);
  if (v) parts.push(`"${v.hi.label}" leads tNPS (${round2(v.hi.tnps)}).`);
  return parts.join(' ') || 'Insufficient data.';
}

/* ──────────── HTML builders ──────────── */

function tsTableRows(rows) {
  return rows.map(r =>
    `              <tr><td>${r.label}</td><td>${r.experts}</td><td>${round2(r.cst)}</td><td>${round2(r.fsTnps)}</td><td>${r.conv !== null ? round2(r.conv) + '%' : 'N/A'}</td><td>${round2(r.ttlaAht)}</td></tr>`
  ).join('\n');
}

function psTableRows(rows) {
  return rows.map(r =>
    `              <tr><td>${r.label}</td><td>${r.experts}</td><td>${round2(r.aht)}</td><td>${round2(r.tnps)}</td></tr>`
  ).join('\n');
}

function tsSurveyTableRows(rows) {
  return rows.map(r =>
    `              <tr><td>${r.label}</td><td>${r.experts}</td><td>${round2(r.cst)}</td><td>${round2(r.fsTnps)}</td><td>${r.conv !== null ? round2(r.conv) : 'N/A'}</td><td>${round2(r.ttlaAht)}</td></tr>`
  ).join('\n');
}

function psSurveyTableRows(rows) {
  return rows.map(r =>
    `              <tr><td>${r.label}</td><td>${r.experts}</td><td>${round2(r.aht)}</td><td>${round2(r.tnps)}</td></tr>`
  ).join('\n');
}

/* ──────────── Chart JS updaters ──────────── */

function chartJsUpdate(canvasId, labels, data) {
  return { canvasId, labels, data };
}

/* ──────────── MAIN ──────────── */

console.log('Loading data...');
const tsDetail = readTsv(TS_DETAIL);
const psDetail = readTsv(PS_DETAIL);
const tsSurveyRaw = readTsv(TS_SURVEY);
const psSurveyRaw = readTsv(PS_SURVEY);

console.log(`TS detail rows: ${tsDetail.length}`);
console.log(`PS detail rows: ${psDetail.length}`);
console.log(`TS survey rows: ${tsSurveyRaw.length}`);
console.log(`PS survey rows: ${psSurveyRaw.length}`);

// Filter to university != null/(Unknown) for university breakdown
function validUniv(r) {
  return !isMissing(r.university) && r.university !== '(Unknown)';
}

// Compute breakdowns
const ts3b = aggregateTs(tsDetail.filter(r => !isMissing(r.university)), 'university');
const ts3e = aggregateTs(tsDetail.filter(r => !isMissing(r.grad_year)), 'grad_year');
const ts3f = aggregateTs(tsDetail.filter(r => !isMissing(r.major)), 'major');
const ts3g = aggregateTs(tsDetail.filter(r => !isMissing(r.remote) && r.remote !== 'NaN'), 'remote');

const ps4b = aggregatePs(psDetail.filter(r => !isMissing(r.university)), 'university');
const ps4e = aggregatePs(psDetail.filter(r => !isMissing(r.grad_year)), 'grad_year');
const ps4f = aggregatePs(psDetail.filter(r => !isMissing(r.major)), 'major');
const ps4g = aggregatePs(psDetail.filter(r => !isMissing(r.remote) && r.remote !== 'NaN'), 'remote');

const tsSurvey = filterSurveyRows(tsSurveyRaw);
const psSurvey = filterSurveyRows(psSurveyRaw);
console.log(`TS survey valid: ${tsSurvey.length}  PS survey valid: ${psSurvey.length}`);

const tsQ1 = aggregateTsSurvey(tsSurvey, 'q1n');
const tsQ2 = aggregateTsSurvey(tsSurvey, 'q2n');
const tsQ3 = aggregateTsSurvey(tsSurvey, 'q3n');

const psQ1 = aggregatePsSurvey(psSurvey, 'q1n');
const psQ2 = aggregatePsSurvey(psSurvey, 'q2n');
const psQ3 = aggregatePsSurvey(psSurvey, 'q3n');

// Print summaries
console.log('\n--- TS 3b University ---');
ts3b.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, CST=${round2(r.cst)}, tNPS=${round2(r.fsTnps)}, Conv=${round2(r.conv)}%, AHT=${round2(r.ttlaAht)}`));
console.log('  Key: ' + tsKeyFinding(ts3b));

console.log('\n--- TS 3e Grad Year ---');
ts3e.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, CST=${round2(r.cst)}, tNPS=${round2(r.fsTnps)}, Conv=${round2(r.conv)}%, AHT=${round2(r.ttlaAht)}`));
console.log('  Key: ' + tsKeyFinding(ts3e));

console.log('\n--- TS 3f Major ---');
ts3f.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, CST=${round2(r.cst)}, tNPS=${round2(r.fsTnps)}, Conv=${round2(r.conv)}%, AHT=${round2(r.ttlaAht)}`));
console.log('  Key: ' + tsKeyFinding(ts3f));

console.log('\n--- TS 3g Location ---');
ts3g.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, CST=${round2(r.cst)}, tNPS=${round2(r.fsTnps)}, Conv=${round2(r.conv)}%, AHT=${round2(r.ttlaAht)}`));
console.log('  Key: ' + tsKeyFinding(ts3g));

console.log('\n--- TS 3h Survey Q1 ---');
tsQ1.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, CST=${round2(r.cst)}, tNPS=${round2(r.fsTnps)}, Conv=${round2(r.conv)}%, AHT=${round2(r.ttlaAht)}`));
console.log('  Key: ' + tsSurveyKeyFinding(tsQ1));

console.log('\n--- PS 4b University ---');
ps4b.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, AHT=${round2(r.aht)}, tNPS=${round2(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(ps4b));

console.log('\n--- PS 4e Grad Year ---');
ps4e.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, AHT=${round2(r.aht)}, tNPS=${round2(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(ps4e));

console.log('\n--- PS 4f Major ---');
ps4f.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, AHT=${round2(r.aht)}, tNPS=${round2(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(ps4f));

console.log('\n--- PS 4g Location ---');
ps4g.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, AHT=${round2(r.aht)}, tNPS=${round2(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(ps4g));

console.log('\n--- PS 4h Survey Q1 ---');
psQ1.forEach(r => console.log(`  ${r.label}: ${r.experts} exp, AHT=${round2(r.aht)}, tNPS=${round2(r.tnps)}`));
console.log('  Key: ' + psSurveyKeyFinding(psQ1));

/* ══════════════════════════════════════════════════
   PATCH THE HTML
   ══════════════════════════════════════════════════ */

console.log('\nPatching HTML...');
let html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function betweenReplace(startM, endM, newMiddle, label) {
  const i = html.indexOf(startM);
  const j = html.indexOf(endM, i + startM.length);
  if (i === -1 || j === -1) throw new Error(`betweenReplace: ${label} markers not found. start=${i}, end=${j}`);
  html = html.slice(0, i + startM.length) + newMiddle + html.slice(j);
}

function replaceSection(sectionId, nextSectionId, newContent, label) {
  const startTag = `<h3 id="${sectionId}">`;
  const endTag = `<h3 id="${nextSectionId}">`;
  const i = html.indexOf(startTag);
  const j = html.indexOf(endTag, i);
  if (i === -1) throw new Error(`replaceSection: ${label} start not found`);
  if (j === -1) throw new Error(`replaceSection: ${label} end not found (nextSection=${nextSectionId})`);
  html = html.slice(0, i) + newContent + '\n\n    ' + html.slice(j);
}

// For the last subsection in a section group, we need a different end marker
function replaceSectionUntil(sectionId, endMarker, newContent, label) {
  const startTag = `<h3 id="${sectionId}">`;
  const i = html.indexOf(startTag);
  if (i === -1) throw new Error(`replaceSectionUntil: ${label} start not found`);
  const j = html.indexOf(endMarker, i);
  if (j === -1) throw new Error(`replaceSectionUntil: ${label} end not found`);
  html = html.slice(0, i) + newContent + '\n\n    ' + html.slice(j);
}

/* ───────── Build section 3b ───────── */
const s3bHtml = `<h3 id="s3b">3b. University</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>University</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsTableRows(ts3b)}
        </tbody>
      </table>
    </div>
    <div class="callout warn">
        <strong>Key:</strong> ${tsKeyFinding(ts3b)}
    </div>
    <div class="chart-row">
      <canvas id="c3bCST"></canvas>
      <canvas id="c3btNPS"></canvas>
    </div>`;

/* ───────── Build section 3e ───────── */
const s3eHtml = `<h3 id="s3e">3e. Graduation Year</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Year</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsTableRows(ts3e)}
        </tbody>
      </table>
    </div>
    <div class="callout">
        ${tsKeyFinding(ts3e)}
    </div>
    <div class="chart-row">
      <canvas id="c3eCST"></canvas>
      <canvas id="c3etNPS"></canvas>
    </div>`;

/* ───────── Build section 3f ───────── */
const s3fHtml = `<h3 id="s3f">3f. Major</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Major</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsTableRows(ts3f)}
        </tbody>
      </table>
    </div>
    <div class="callout success">
        ${tsKeyFinding(ts3f)}
    </div>
    <div class="chart-row">
      <canvas id="c3fCST"></canvas>
      <canvas id="c3ftNPS"></canvas>
    </div>`;

/* ───────── Build section 3g ───────── */
const s3gHtml = `<h3 id="s3g">3g. Working Location</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Location</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsTableRows(ts3g)}
        </tbody>
      </table>
    </div>
    <div class="callout warn">
        ${tsKeyFinding(ts3g)}
    </div>`;

/* ───────── Build section 3h ───────── */
const s3hHtml = `<h3 id="s3h">3h. Survey Response Analysis</h3>

    <div class="card">
      <h4>Q1 — Why did you join PathEDU?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsSurveyTableRows(tsQ1)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${tsSurveyKeyFinding(tsQ1)}</p>
    </div>

    <div class="card">
      <h4>Q2 — How do you view this role?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsSurveyTableRows(tsQ2)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${tsSurveyKeyFinding(tsQ2)}</p>
    </div>

    <div class="card">
      <h4>Q3 — How relevant is this to your career?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv %</th><th>TTLA AHT</th></tr>
        </thead>
        <tbody>
${tsSurveyTableRows(tsQ3)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${tsSurveyKeyFinding(tsQ3)}</p>
    </div>

    <div class="chart-row">
      <canvas id="c3gCST"></canvas>
      <canvas id="c3gtNPS"></canvas>
    </div>`;

/* ───────── Build section 4b ───────── */
const s4bHtml = `<h3 id="s4b">4b. University</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>University</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psTableRows(ps4b)}
        </tbody>
      </table>
    </div>
    <div class="callout danger">
        <strong>Key:</strong> ${psKeyFinding(ps4b)}
    </div>
    <div class="chart-row">
      <canvas id="c4bAHT"></canvas>
      <canvas id="c4btNPS"></canvas>
    </div>`;

/* ───────── Build section 4e ───────── */
const s4eHtml = `<h3 id="s4e">4e. Graduation Year</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Year</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psTableRows(ps4e)}
        </tbody>
      </table>
    </div>
    <div class="callout">
        ${psKeyFinding(ps4e)}
    </div>
    <div class="chart-row">
      <canvas id="c4eAHT"></canvas>
      <canvas id="c4etNPS"></canvas>
    </div>`;

/* ───────── Build section 4f ───────── */
const s4fHtml = `<h3 id="s4f">4f. Major</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Major</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psTableRows(ps4f)}
        </tbody>
      </table>
    </div>
    <div class="callout">
        ${psKeyFinding(ps4f)}
    </div>
    <div class="chart-row">
      <canvas id="c4fAHT"></canvas>
      <canvas id="c4ftNPS"></canvas>
    </div>`;

/* ───────── Build section 4g ───────── */
const s4gHtml = `<h3 id="s4g">4g. Working Location</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Location</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psTableRows(ps4g)}
        </tbody>
      </table>
    </div>
    <div class="callout warn">
        ${psKeyFinding(ps4g)}
    </div>`;

/* ───────── Build section 4h ───────── */
const s4hHtml = `<h3 id="s4h">4h. Survey Response Analysis</h3>

    <div class="card">
      <h4>Q1 — Why did you join PathEDU?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
        </thead>
        <tbody>
${psSurveyTableRows(psQ1)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${psSurveyKeyFinding(psQ1)}</p>
    </div>

    <div class="card">
      <h4>Q2 — How do you view this role?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
        </thead>
        <tbody>
${psSurveyTableRows(psQ2)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${psSurveyKeyFinding(psQ2)}</p>
    </div>

    <div class="card">
      <h4>Q3 — How relevant is this to your career?</h4>
      <table>
        <thead>
          <tr><th>Response</th><th>Experts</th><th>PS AHT</th><th>PS tNPS</th></tr>
        </thead>
        <tbody>
${psSurveyTableRows(psQ3)}
        </tbody>
      </table>
      <p><strong>Key:</strong> ${psSurveyKeyFinding(psQ3)}</p>
    </div>

    <div class="chart-row">
      <canvas id="c4gAHT"></canvas>
      <canvas id="c4gtNPS"></canvas>
    </div>`;

/* ══════════════════════════════════════════════════
   APPLY REPLACEMENTS
   ══════════════════════════════════════════════════ */

// 3b: starts at <h3 id="s3b">, ends before <h3 id="s3c">
replaceSection('s3b', 's3c', s3bHtml, '3b');
console.log('  ✓ 3b replaced');

// 3e: starts at <h3 id="s3e">, ends before <h3 id="s3f">
replaceSection('s3e', 's3f', s3eHtml, '3e');
console.log('  ✓ 3e replaced');

// 3f: starts at <h3 id="s3f">, ends before <h3 id="s3g">
replaceSection('s3f', 's3g', s3fHtml, '3f');
console.log('  ✓ 3f replaced');

// 3g + 3h: these run together until the Section 4 divider
// Find the end marker for section 3 (the section 4 header)
const SEC4_MARKER = '<h2 id="s4">';
replaceSectionUntil('s3g', SEC4_MARKER, s3gHtml + '\n\n    ' + s3hHtml, '3g+3h');
console.log('  ✓ 3g + 3h replaced');

// 4b: starts at <h3 id="s4b">, ends before <h3 id="s4c">
replaceSection('s4b', 's4c', s4bHtml, '4b');
console.log('  ✓ 4b replaced');

// 4e: starts at <h3 id="s4e">, ends before <h3 id="s4f">
replaceSection('s4e', 's4f', s4eHtml, '4e');
console.log('  ✓ 4e replaced');

// 4f: starts at <h3 id="s4f">, ends before <h3 id="s4g">
replaceSection('s4f', 's4g', s4fHtml, '4f');
console.log('  ✓ 4f replaced');

// 4g + 4h: run together until section 5
const SEC5_MARKER = '<h2 id="s5">';
replaceSectionUntil('s4g', SEC5_MARKER, s4gHtml + '\n\n    ' + s4hHtml, '4g+4h');
console.log('  ✓ 4g + 4h replaced');

/* ══════════════════════════════════════════════════
   UPDATE CHART.JS DATA ARRAYS
   ══════════════════════════════════════════════════ */

function updateChart(canvasId, newLabels, newDatasets) {
  const regex = new RegExp(
    `(new Chart\\(document\\.getElementById\\(['"]${canvasId}['"]\\)\\.getContext\\(['"]2d['"]\\),\\s*\\{[\\s\\S]*?data:\\s*\\{)([\\s\\S]*?)(\\}\\s*,\\s*options:)`,
    'g'
  );
  const match = regex.exec(html);
  if (!match) {
    console.log(`  ⚠ Chart ${canvasId} not found in JS — skipping`);
    return;
  }

  const labelsStr = JSON.stringify(newLabels);
  let datasetsStr = 'datasets: [';
  for (const ds of newDatasets) {
    datasetsStr += `{label:'${ds.label}',data:${JSON.stringify(ds.data)},backgroundColor:'${ds.bg}',borderColor:'${ds.border || ds.bg}',borderWidth:1},`;
  }
  datasetsStr += ']';

  const newData = `\n            labels: ${labelsStr},\n            ${datasetsStr}\n          `;
  html = html.slice(0, match.index + match[1].length) + newData + html.slice(match.index + match[1].length + match[2].length);
}

// --- 3b charts ---
const ts3bTop = ts3b.filter(r => r.experts >= 3).slice(0, 10);
updateChart('c3bCST',
  ts3bTop.map(r => r.label.length > 20 ? r.label.slice(0, 18) + '…' : r.label),
  [{ label: 'CST', data: ts3bTop.map(r => r.cst !== null ? +round2(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]
);
updateChart('c3btNPS',
  ts3bTop.map(r => r.label.length > 20 ? r.label.slice(0, 18) + '…' : r.label),
  [{ label: 'FS tNPS', data: ts3bTop.map(r => r.fsTnps !== null ? +round2(r.fsTnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]
);
console.log('  ✓ 3b charts updated');

// --- 3e charts ---
updateChart('c3eCST',
  ts3e.map(r => r.label),
  [{ label: 'CST', data: ts3e.map(r => r.cst !== null ? +round2(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]
);
updateChart('c3etNPS',
  ts3e.map(r => r.label),
  [{ label: 'FS tNPS', data: ts3e.map(r => r.fsTnps !== null ? +round2(r.fsTnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]
);
console.log('  ✓ 3e charts updated');

// --- 3f charts ---
updateChart('c3fCST',
  ts3f.map(r => r.label),
  [{ label: 'CST', data: ts3f.map(r => r.cst !== null ? +round2(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]
);
updateChart('c3ftNPS',
  ts3f.map(r => r.label),
  [{ label: 'FS tNPS', data: ts3f.map(r => r.fsTnps !== null ? +round2(r.fsTnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]
);
console.log('  ✓ 3f charts updated');

// --- 3g charts (canvas ids are c3gCST, c3gtNPS) ---
updateChart('c3gCST',
  ts3g.map(r => r.label),
  [{ label: 'CST', data: ts3g.map(r => r.cst !== null ? +round2(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]
);
updateChart('c3gtNPS',
  ts3g.map(r => r.label),
  [{ label: 'FS tNPS', data: ts3g.map(r => r.fsTnps !== null ? +round2(r.fsTnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]
);
console.log('  ✓ 3g charts updated');

// --- 4b charts ---
const ps4bTop = ps4b.filter(r => r.experts >= 3).slice(0, 12);
updateChart('c4bAHT',
  ps4bTop.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
  [{ label: 'AHT', data: ps4bTop.map(r => r.aht !== null ? +round2(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]
);
updateChart('c4btNPS',
  ps4bTop.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
  [{ label: 'tNPS', data: ps4bTop.map(r => r.tnps !== null ? +round2(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]
);
console.log('  ✓ 4b charts updated');

// --- 4e charts ---
updateChart('c4eAHT',
  ps4e.map(r => r.label),
  [{ label: 'AHT', data: ps4e.map(r => r.aht !== null ? +round2(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]
);
updateChart('c4etNPS',
  ps4e.map(r => r.label),
  [{ label: 'tNPS', data: ps4e.map(r => r.tnps !== null ? +round2(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]
);
console.log('  ✓ 4e charts updated');

// --- 4f charts ---
updateChart('c4fAHT',
  ps4f.map(r => r.label),
  [{ label: 'AHT', data: ps4f.map(r => r.aht !== null ? +round2(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]
);
updateChart('c4ftNPS',
  ps4f.map(r => r.label),
  [{ label: 'tNPS', data: ps4f.map(r => r.tnps !== null ? +round2(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]
);
console.log('  ✓ 4f charts updated');

// --- 4g charts (canvas ids are c4gAHT, c4gtNPS) ---
updateChart('c4gAHT',
  ps4g.map(r => r.label),
  [{ label: 'AHT', data: ps4g.map(r => r.aht !== null ? +round2(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]
);
updateChart('c4gtNPS',
  ps4g.map(r => r.label),
  [{ label: 'tNPS', data: ps4g.map(r => r.tnps !== null ? +round2(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]
);
console.log('  ✓ 4g charts updated');

/* ──────── update footer date ──────── */
html = html.replace(/Report generated on [A-Za-z]+ \d+, \d{4}/, 'Report generated on May 18, 2026');

/* ──────── verify & write ──────── */
const divOpen = (html.match(/<div/g) || []).length;
const divClose = (html.match(/<\/div>/g) || []).length;
if (divOpen !== divClose) {
  console.error(`WARNING: div mismatch — open ${divOpen}, close ${divClose}`);
} else {
  console.log(`  ✓ div balance OK (${divOpen})`);
}

fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log(`\n✅ Done — wrote ${HTML_PATH} (${(html.length / 1024).toFixed(0)} KB)`);
