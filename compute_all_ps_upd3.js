'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function parseTSV(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    const row = {};
    headers.forEach((h, j) => {
      row[h] = parts[j] !== undefined ? parts[j].trim() : '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function parseNum(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseNullableNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isValidDim(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return false;
  return true;
}

function makeAgg() {
  return {
    expert_cnt: 0,
    ps_handle_min: 0,
    ps_handle_cnt: 0,
    ps_tnps_num: 0,
    ps_tnps_denom: 0,
  };
}

function addOverallRow(agg, row) {
  agg.expert_cnt += parseNum(row.expert_cnt);
  agg.ps_handle_min += parseNum(row.ps_handle_min);
  agg.ps_handle_cnt += parseNum(row.ps_handle_cnt);
  const tn = parseNullableNum(row.ps_tnps_num);
  const td = parseNullableNum(row.ps_tnps_denom);
  if (tn !== null && td !== null) {
    agg.ps_tnps_num += tn;
    agg.ps_tnps_denom += td;
  }
}

function finalizeAgg(agg) {
  const aht = agg.ps_handle_cnt > 0 ? agg.ps_handle_min / agg.ps_handle_cnt : null;
  const tnps = agg.ps_tnps_denom > 0 ? (agg.ps_tnps_num / agg.ps_tnps_denom) * 100 : null;
  return { ...agg, ps_aht: aht, ps_tnps_pct: tnps };
}

function fmtNum(n, d = 4) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return Number(n).toFixed(d);
}

function printAggLine(label, f) {
  const aht = f.ps_aht;
  const tnps = f.ps_tnps_pct;
  console.log(
    `  ${label}: expert_cnt=${Math.round(f.expert_cnt)} | PS AHT=${fmtNum(aht, 4)} | PS tNPS=${fmtNum(tnps, 4)}% | (tnps: num ${fmtNum(f.ps_tnps_num, 2)}, denom ${fmtNum(f.ps_tnps_denom, 2)})`
  );
}

function printAggMapSorted(byKeyMap) {
  const entries = [...byKeyMap.entries()]
    .map(([key, agg]) => ({ key, f: finalizeAgg(agg) }))
    .sort((a, b) => b.f.expert_cnt - a.f.expert_cnt);
  for (const e of entries) printAggLine(e.key, e.f);
}

const PATH_PARTNERS = new Set(['EDUCATION AT WORK', 'FOUNDEVER']);

function aggregateBy(rows, predicate, keyFn) {
  const map = new Map();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, makeAgg());
    addOverallRow(map.get(k), row);
  }
  return map;
}

function keyFindingsDetail(dimName, entries) {
  const withData = entries.filter((e) => e.f.expert_cnt > 0);
  if (!withData.length) return `No PathEDU PS rows after filters for ${dimName}.`;

  const bySize = [...withData].sort((a, b) => b.f.expert_cnt - a.f.expert_cnt);
  const largest = bySize[0];
  const substantialTnps = withData.filter((e) => e.f.expert_cnt >= 8 && e.f.ps_tnps_denom >= 50);
  const tnpsPool = substantialTnps.length >= 2 ? substantialTnps : withData.filter((e) => e.f.ps_tnps_denom > 0);
  if (tnpsPool.length < 2) {
    return `"${largest.key}" is the largest segment (${Math.round(largest.f.expert_cnt)} experts); tNPS spread across other ${dimName.toLowerCase()} values is limited by sample or response volume.`;
  }
  const bestTnps = [...tnpsPool].sort((a, b) => (b.f.ps_tnps_pct || 0) - (a.f.ps_tnps_pct || 0))[0];
  const worstTnps = [...tnpsPool].sort((a, b) => (a.f.ps_tnps_pct || 0) - (b.f.ps_tnps_pct || 0))[0];
  const substantialAht = withData.filter((e) => e.f.ps_handle_cnt > 0 && e.f.expert_cnt >= 8);
  const ahtPool = substantialAht.length >= 2 ? substantialAht : withData.filter((e) => e.f.ps_handle_cnt > 0);
  const bestAht = [...ahtPool].sort((a, b) => (a.f.ps_aht || 0) - (b.f.ps_aht || 0))[0];
  if (bestTnps.key === worstTnps.key) {
    return `"${largest.key}" dominates volume (${Math.round(largest.f.expert_cnt)} experts). Fastest PS AHT among listed values is "${bestAht.key}" (${fmtNum(bestAht.f.ps_aht, 2)} min).`;
  }
  return `"${largest.key}" is the largest segment (${Math.round(largest.f.expert_cnt)} experts). Among segments with meaningful tNPS volume, "${bestTnps.key}" leads on tNPS (${fmtNum(bestTnps.f.ps_tnps_pct, 2)}%) vs "${worstTnps.key}" (${fmtNum(worstTnps.f.ps_tnps_pct, 2)}%); lowest PS AHT is "${bestAht.key}" (${fmtNum(bestAht.f.ps_aht, 2)} min).`;
}

// --- Main ---
const overallPath = path.join(ROOT, 'data_ps_overall_upd3.tsv');
const detailPath = path.join(ROOT, 'data_ps_detail_upd3.tsv');

const { rows: overallRows } = parseTSV(fs.readFileSync(overallPath, 'utf8'));
const detailContent = fs.readFileSync(detailPath, 'utf8');
const { rows: detailRows } = parseTSV(detailContent);

const psOverall = overallRows.filter((r) => r.role_type === 'PS');

console.log('='.repeat(80));
console.log('PS OVERALL (data_ps_overall_upd3.tsv, role_type=PS)');
console.log('='.repeat(80));

console.log('\n--- NonPathEDU vs PathEDU (overall) ---');
for (const et of ['NonPathEDU', 'PathEDU']) {
  const a = makeAgg();
  for (const r of psOverall) {
    if (r.expert_type === et) addOverallRow(a, r);
  }
  printAggLine(et, finalizeAgg(a));
}

console.log('\n--- By hire type (New Hire / Re-Hire), both groups ---');
for (const et of ['NonPathEDU', 'PathEDU']) {
  console.log(`\n  [${et}]`);
  for (const ht of ['New Hire', 'Re-Hire']) {
    const a = makeAgg();
    for (const r of psOverall) {
      if (r.expert_type === et && r.hire_type === ht) addOverallRow(a, r);
    }
    printAggLine(ht, finalizeAgg(a));
  }
}

console.log('\n--- NonPathEDU partner breakdown (by partner_name, all waves rolled up) ---');
{
  const byPartner = aggregateBy(
    psOverall,
    (r) => r.expert_type === 'NonPathEDU' && isValidDim(r.partner_name),
    (r) => r.partner_name
  );
  const total = makeAgg();
  for (const r of psOverall) {
    if (r.expert_type !== 'NonPathEDU' || !isValidDim(r.partner_name)) continue;
    addOverallRow(total, r);
  }
  printAggLine('NonPathEDU total (all partners)', finalizeAgg(total));
  printAggMapSorted(byPartner);
}

console.log('\n--- PathEDU partner breakdown (EDUCATION AT WORK, FOUNDEVER) ---');
{
  const byPartner = aggregateBy(
    psOverall,
    (r) => r.expert_type === 'PathEDU' && PATH_PARTNERS.has(r.partner_name),
    (r) => r.partner_name
  );
  printAggMapSorted(byPartner);
}

console.log('\n--- PathEDU training wave breakdown ---');
{
  const byWave = aggregateBy(
    psOverall,
    (r) => r.expert_type === 'PathEDU' && isValidDim(r.training_wave),
    (r) => r.training_wave
  );
  printAggMapSorted(byWave);
}

console.log('\n' + '='.repeat(80));
console.log('PS DETAIL — PathEDU only (data_ps_detail_upd3.tsv)');
console.log('='.repeat(80));

function detailDimension(dimField, dimTitle) {
  console.log(`\n--- ${dimTitle} (${dimField}) ---`);
  const map = new Map();
  for (const r of detailRows) {
    if (r.expert_type !== 'PathEDU' || r.role_type !== 'PS') continue;
    const key = r[dimField];
    if (!isValidDim(key)) continue;
    if (!map.has(key)) map.set(key, makeAgg());
    const agg = map.get(key);
    agg.expert_cnt += parseNum(r.expert_cnt);
    agg.ps_handle_min += parseNum(r.ps_handle_min);
    agg.ps_handle_cnt += parseNum(r.ps_handle_cnt);
    const tn = parseNullableNum(r.ps_tnps_num);
    const td = parseNullableNum(r.ps_tnps_denom);
    if (tn !== null && td !== null) {
      agg.ps_tnps_num += tn;
      agg.ps_tnps_denom += td;
    }
  }
  const entries = [...map.entries()]
    .map(([key, agg]) => ({ key, f: finalizeAgg(agg) }))
    .sort((a, b) => b.f.expert_cnt - a.f.expert_cnt);
  for (const e of entries) {
    printAggLine(e.key, e.f);
  }
  console.log(`\n  Key Finding: ${keyFindingsDetail(dimTitle, entries)}`);
}

detailDimension('partner_name', 'Partner');
detailDimension('university', 'University');
detailDimension('attr_status_adj', 'Attrition stage');
detailDimension('training_wave', 'Training wave');
detailDimension('grad_year', 'Graduation year');
detailDimension('major', 'Major');
detailDimension('remote', 'Working location');

console.log('\n' + '='.repeat(80));
console.log('Done.');
console.log('='.repeat(80));
