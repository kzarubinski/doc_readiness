'use strict';

const fs = require('fs');
const path = require('path');

const TS_PATH = path.join(__dirname, 'data_ts_survey_upd3.tsv');
const PS_PATH = path.join(__dirname, 'data_ps_survey_upd3.tsv');

const results = { ts: {}, ps: {} };

function log(...args) {
  console.log(...args);
}

function readTsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trimEnd();
  const lines = raw.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] !== undefined ? vals[i].trim() : '';
    });
    return obj;
  });
}

function isSurveyMissing(v) {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  if (s === '') return true;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'nan') return true;
  return false;
}

function isNumMissing(v) {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return true;
  return false;
}

function num(v) {
  if (isNumMissing(v)) return null;
  const n = parseFloat(String(v).replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Canonical q1 / q2 after normalization */
function normalizeQ1(s) {
  const t = String(s).trim();
  if (!t) return null;
  const low = t.replace(/\s+/g, ' ').toLowerCase();
  const resume =
    low.includes('build my resume') &&
    (low.includes('skill') || low.includes('/ skill'));
  if (resume) return 'Build my resume/skills';
  if (low.includes('gain experience') && low.includes('future career'))
    return 'Gain experience relevant to my future career';
  if (low.includes('earn income') && low.includes('school'))
    return 'Earn income while in school';
  if (low.includes('flexible work') && low.includes('schedule'))
    return 'Flexible work that fits my schedule';
  return null;
}

function normalizeQ2(s) {
  const t = String(s).trim();
  if (!t) return null;
  const low = t.replace(/\s+/g, ' ').toLowerCase();
  if (
    low.includes('mix') &&
    low.includes('income') &&
    (low.includes('career building') || low.includes('career-building'))
  ) {
    return 'A mix of income and career building';
  }
  if (low.includes('mostly') && low.includes('career-building') && low.includes('opportunity'))
    return 'Mostly a career-building opportunity';
  if (low.includes('mostly') && low.includes('job') && low.includes('earn money'))
    return 'Mostly a job to earn money';
  return null;
}

function normalizeQ3(s) {
  const t = String(s).trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (low === 'very relevant') return 'Very relevant';
  if (low === 'somewhat relevant') return 'Somewhat relevant';
  if (low === 'not relevant') return 'Not relevant';
  return null;
}

function filterSurveyRows(rows) {
  return rows.filter((r) => {
    if (isSurveyMissing(r.q1) || isSurveyMissing(r.q2) || isSurveyMissing(r.q3)) return false;
    const q1 = normalizeQ1(r.q1);
    const q2 = normalizeQ2(r.q2);
    const q3 = normalizeQ3(r.q3);
    return q1 && q2 && q3;
  });
}

function withNormalizedSurvey(r) {
  return {
    ...r,
    q1n: normalizeQ1(r.q1),
    q2n: normalizeQ2(r.q2),
    q3n: normalizeQ3(r.q3),
  };
}

function emptyTsAcc() {
  return {
    expert_cnt: 0,
    fs_cst_num: 0,
    fs_eng: 0,
    exec_fs_tnps_num: 0,
    exec_fs_tnps_denom: 0,
    ttla_handle_min: 0,
    ttla_handle_cnt: 0,
    conv_num: 0,
    conv_denom: 0,
  };
}

function addTsRow(acc, r) {
  const ex = num(r.expert_cnt);
  if (ex !== null) acc.expert_cnt += ex;

  const cn = num(r.fs_cst_num);
  const fe = num(r.fs_eng);
  if (cn !== null && fe !== null) {
    acc.fs_cst_num += cn;
    acc.fs_eng += fe;
  }

  const fn = num(r.exec_fs_tnps_num);
  const fd = num(r.exec_fs_tnps_denom);
  if (fn !== null && fd !== null) {
    acc.exec_fs_tnps_num += fn;
    acc.exec_fs_tnps_denom += fd;
  }

  const tm = num(r.ttla_handle_min);
  const tc = num(r.ttla_handle_cnt);
  if (tm !== null && tc !== null) {
    acc.ttla_handle_min += tm;
    acc.ttla_handle_cnt += tc;
  }

  const cvn = num(r.conv_num);
  const cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) {
    acc.conv_num += cvn;
    acc.conv_denom += cvd;
  }
}

function tsAccToRow(label, acc) {
  const cst = acc.fs_eng > 0 ? acc.fs_cst_num / acc.fs_eng : null;
  const fsTnps =
    acc.exec_fs_tnps_denom > 0
      ? (acc.exec_fs_tnps_num / acc.exec_fs_tnps_denom) * 100
      : null;
  const convRate = acc.conv_denom > 0 ? (acc.conv_num / acc.conv_denom) * 100 : null;
  const ttlaAht = acc.ttla_handle_cnt > 0 ? acc.ttla_handle_min / acc.ttla_handle_cnt : null;
  return {
    label,
    expert_cnt: acc.expert_cnt,
    cst,
    fs_tnps: fsTnps,
    conv_rate: convRate,
    ttla_aht: ttlaAht,
  };
}

function aggregateTs(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = r[field];
    if (!map.has(key)) map.set(key, emptyTsAcc());
    addTsRow(map.get(key), r);
  }
  return [...map.entries()]
    .map(([label, acc]) => tsAccToRow(label, acc))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function emptyPsAcc() {
  return {
    expert_cnt: 0,
    ps_handle_min: 0,
    ps_handle_cnt: 0,
    ps_tnps_num: 0,
    ps_tnps_denom: 0,
  };
}

function addPsRow(acc, r) {
  const ex = num(r.expert_cnt);
  if (ex !== null) acc.expert_cnt += ex;

  const hm = num(r.ps_handle_min);
  const hc = num(r.ps_handle_cnt);
  if (hm !== null && hc !== null) {
    acc.ps_handle_min += hm;
    acc.ps_handle_cnt += hc;
  }

  const tn = num(r.ps_tnps_num);
  const td = num(r.ps_tnps_denom);
  if (tn !== null && td !== null) {
    acc.ps_tnps_num += tn;
    acc.ps_tnps_denom += td;
  }
}

function psAccToRow(label, acc) {
  const aht = acc.ps_handle_cnt > 0 ? acc.ps_handle_min / acc.ps_handle_cnt : null;
  const tnps = acc.ps_tnps_denom > 0 ? (acc.ps_tnps_num / acc.ps_tnps_denom) * 100 : null;
  return {
    label,
    expert_cnt: acc.expert_cnt,
    ps_aht: aht,
    ps_tnps: tnps,
  };
}

function aggregatePs(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = r[field];
    if (!map.has(key)) map.set(key, emptyPsAcc());
    addPsRow(map.get(key), r);
  }
  return [...map.entries()]
    .map(([label, acc]) => psAccToRow(label, acc))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'N/A';
  return Number(n).toFixed(digits);
}

function printTsTable(title, rows) {
  log(`\n${title}`);
  log(
    [
      'response'.padEnd(48),
      'expert_cnt'.padStart(10),
      'CST'.padStart(10),
      'FS_tNPS%'.padStart(10),
      'Conv%'.padStart(10),
      'TTLA_AHT'.padStart(12),
    ].join('  ')
  );
  log('-'.repeat(100));
  for (const r of rows) {
    log(
      [
        r.label.slice(0, 47).padEnd(48),
        String(Math.round(r.expert_cnt)).padStart(10),
        fmt(r.cst).padStart(10),
        fmt(r.fs_tnps).padStart(10),
        fmt(r.conv_rate).padStart(10),
        fmt(r.ttla_aht).padStart(12),
      ].join('  ')
    );
  }
}

function printPsTable(title, rows) {
  log(`\n${title}`);
  log(['response'.padEnd(48), 'expert_cnt'.padStart(10), 'PS_AHT'.padStart(12), 'PS_tNPS%'.padStart(10)].join('  '));
  log('-'.repeat(86));
  for (const r of rows) {
    log(
      [
        r.label.slice(0, 47).padEnd(48),
        String(Math.round(r.expert_cnt)).padStart(10),
        fmt(r.ps_aht).padStart(12),
        fmt(r.ps_tnps).padStart(10),
      ].join('  ')
    );
  }
}

function rangeSentence(metricName, rows, key, higherIsBetter = true) {
  const ok = rows.filter((r) => r[key] !== null && Number.isFinite(r[key]));
  if (ok.length < 2) return '';
  const sorted = [...ok].sort((a, b) => a[key] - b[key]);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const spread = hi[key] - lo[key];
  if (spread === 0) return `${metricName} is identical (${fmt(lo[key])}) across groups.`;
  const better = higherIsBetter ? hi : lo;
  const worse = higherIsBetter ? lo : hi;
  return `${metricName} runs from ${fmt(lo[key])} (${lo.label}) up to ${fmt(hi[key])} (${hi.label}); the ${
    higherIsBetter ? 'highest' : 'lowest'
  } value is ${fmt(better[key])} for "${better.label}" vs ${fmt(worse[key])} for "${worse.label}".`;
}

function keyFindingTs(qName, rows) {
  const parts = [
    rangeSentence('Weighted CST (fs_cst_num/fs_eng)', rows, 'cst', false),
    rangeSentence('FS tNPS', rows, 'fs_tnps', true),
    rangeSentence('Conversion rate %', rows, 'conv_rate', true),
    rangeSentence('TTLA AHT (minutes per handle)', rows, 'ttla_aht', false),
  ].filter(Boolean);
  const head = parts.slice(0, 2).join(' ');
  return `${qName}: ${head || 'Insufficient distinct metric values across groups for a spread summary.'}`;
}

function keyFindingPs(qName, rows) {
  const parts = [
    rangeSentence('PS AHT (minutes per handle)', rows, 'ps_aht', false),
    rangeSentence('PS tNPS', rows, 'ps_tnps', true),
  ].filter(Boolean);
  const head = parts.slice(0, 2).join(' ');
  return `${qName}: ${head || 'Insufficient distinct metric values across groups for a spread summary.'}`;
}

function rowToPlainTs(r) {
  return {
    label: r.label,
    expert_cnt: r.expert_cnt,
    cst: r.cst,
    fs_tnps_pct: r.fs_tnps,
    conv_rate_pct: r.conv_rate,
    ttla_aht: r.ttla_aht,
  };
}

function rowToPlainPs(r) {
  return {
    label: r.label,
    expert_cnt: r.expert_cnt,
    ps_aht: r.ps_aht,
    ps_tnps_pct: r.ps_tnps,
  };
}

// --- Run ---
const tsRaw = readTsv(TS_PATH);
const psRaw = readTsv(PS_PATH);

const tsRows = filterSurveyRows(tsRaw).map(withNormalizedSurvey);
const psRows = filterSurveyRows(psRaw).map(withNormalizedSurvey);

log('=== Part 1: TS Survey (data_ts_survey_upd3.tsv) ===');
log(`Rows with complete q1/q2/q3: ${tsRows.length} (of ${tsRaw.length} total lines)`);

for (const dim of ['q1n', 'q2n', 'q3n']) {
  const label = dim === 'q1n' ? 'q1' : dim === 'q2n' ? 'q2' : 'q3';
  const agg = aggregateTs(tsRows, dim);
  results.ts[label] = agg.map(rowToPlainTs);
  printTsTable(`TS by ${label} (normalized)`, agg);
  log(`\nKey finding (${label}):`);
  log(keyFindingTs(label.toUpperCase(), agg));
}

log('\n\n=== Part 2: PS Survey (data_ps_survey_upd3.tsv) ===');
log(`Rows with complete q1/q2/q3: ${psRows.length} (of ${psRaw.length} total lines)`);

for (const dim of ['q1n', 'q2n', 'q3n']) {
  const label = dim === 'q1n' ? 'q1' : dim === 'q2n' ? 'q2' : 'q3';
  const agg = aggregatePs(psRows, dim);
  results.ps[label] = agg.map(rowToPlainPs);
  printPsTable(`PS by ${label} (normalized)`, agg);
  log(`\nKey finding (${label}):`);
  log(keyFindingPs(label.toUpperCase(), agg));
}

log('\n\n=== ALL COMPUTED VALUES (JSON) ===');
log(JSON.stringify(results, null, 2));
