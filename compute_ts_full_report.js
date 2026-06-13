'use strict';

const fs = require('fs');
const path = require('path');

const CURSOR = path.join(process.env.USERPROFILE || '', 'Cursor');
const DP = path.join(CURSOR, 'Expert_Analysis_data_DP.csv');
const DP2 = path.join(CURSOR, 'Expert_Analysis_data_DP2.csv');
const DP3 = path.join(CURSOR, 'Expert_Analysis_data_DP3.csv');
const OUT = path.join(__dirname, 'ts_full_report.json');

const FS = 'TTL Full Service Consumer';
const TTLA = 'TTL Assisted Consumer';
const TRIAGE = new Set(['TRIAGE', 'AMEND']);
const SKUS = ['basic', 'deluxe', 'premium'];
const CUST = ['New', 'Returning'];

function loadCsv(p) {
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const headers = raw.trim().split('\n')[0].split(',');
  return raw.trim().split('\n').slice(1).map((line) => {
    const vals = line.split(',');
    const o = {};
    headers.forEach((h, i) => { o[h.trim()] = vals[i] ?? ''; });
    return o;
  });
}

const isTS = (r) => r.expert_role === 'Tax Specialist';
const isNTS = (r) => r.expert_role === 'Tax Associate' || r.expert_role === 'Tax Expert';
const isPL1NH = (r) => r.proficiency_level_start === 'PL1' && r.hire_type === 'New Hire';
const isTriageAmend = (r) => TRIAGE.has((r.forecast_group_category || '').toUpperCase());
const isNonTriage = (r) => {
  const fg = (r.forecast_group_category || '').toUpperCase();
  return fg && fg !== 'NULL' && !TRIAGE.has(fg);
};

function sum(rows, f) {
  return rows.reduce((a, r) => a + (parseFloat(r[f]) || 0), 0);
}

function ratio(rows, key, mult = 1) {
  const num = key === 'hc' ? 'handled_conversion_numerator' : `${key}_numerator`;
  const den = key === 'hc' ? 'handled_conversion_denominator' : `${key}_denominator`;
  const d = sum(rows, den);
  return d ? (sum(rows, num) / d) * mult : null;
}

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n.toFixed(d));
}

function gap(a, b) { return fmt(a - b); }
function mixEff(a, b) { return fmt(b - a); }
function cls(g, lowerBetter = false) {
  if (g == null) return '';
  const good = lowerBetter ? g < 0 : g > 0;
  const bad = lowerBetter ? g > 0 : g < 0;
  if (Math.abs(g) < 0.005) return '';
  return good ? 'better' : bad ? 'worse' : '';
}

// DP3 typo: premium CST denominator is cst_premiun_denominator (not cst_premium_denominator)
function skuMetricFields(prefix, sku) {
  if (prefix === 'cst' && sku === 'premium') {
    return { num: 'cst_premium_numerator', den: 'cst_premiun_denominator' };
  }
  return { num: `${prefix}_${sku}_numerator`, den: `${prefix}_${sku}_denominator` };
}

function skuCustMix(tsR, ntsR, prefix, mult = 1) {
  let w = 0, t = 0;
  for (const s of SKUS) for (const c of CUST) {
    const tsC = tsR.filter((r) => r.new_returning_customer === c);
    const ntC = ntsR.filter((r) => r.new_returning_customer === c);
    const { num: nf, den: df } = skuMetricFields(prefix, s);
    const td = sum(tsC, df), nd = sum(ntC, df);
    if (!td || !nd) continue;
    w += (sum(tsC, nf) / td) * mult * nd;
    t += nd;
  }
  return t ? w / t : null;
}

function custMix(tsR, ntsR, prefix, mult = 1) {
  let w = 0, t = 0;
  for (const c of CUST) {
    const tsC = tsR.filter((r) => r.new_returning_customer === c);
    const ntC = ntsR.filter((r) => r.new_returning_customer === c);
    const td = sum(tsC, `${prefix}_denominator`), nd = sum(ntC, `${prefix}_denominator`);
    if (!td || !nd) continue;
    w += (sum(tsC, `${prefix}_numerator`) / td) * mult * nd;
    t += nd;
  }
  return t ? w / t : null;
}

function skuMix(tsR, ntsR, prefix, mult = 1) {
  let w = 0, t = 0;
  for (const s of SKUS) {
    const { num: nf, den: df } = skuMetricFields(prefix, s);
    const td = sum(tsR, df), nd = sum(ntsR, df);
    if (!td || !nd) continue;
    w += (sum(tsR, nf) / td) * mult * nd;
    t += nd;
  }
  return t ? w / t : null;
}

function hcActual(rows) { return ratio(rows, 'hc', 100); }

function buildMix(tsR, ntsR, specs) {
  const out = {};
  for (const s of specs) {
    const actual = s.key === 'hc' ? hcActual(tsR) : ratio(tsR, s.key, s.mult);
    const nts = s.key === 'hc' ? hcActual(ntsR) : ratio(ntsR, s.key, s.mult);
    let adj = actual;
    if (s.type === 'skuCust') {
      if (s.key === 'hc') adj = skuCustMix(tsR, ntsR, 'hc', s.mult);
      else adj = skuCustMix(tsR, ntsR, s.key, s.mult);
    } else if (s.type === 'cust') {
      adj = custMix(tsR, ntsR, s.key === 'hc' ? 'handled_conversion' : s.key, s.mult);
    } else if (s.type === 'sku') adj = skuMix(tsR, ntsR, s.key, s.mult);
    out[s.name] = {
      actual: fmt(actual), adj: fmt(adj), nts: fmt(nts),
      rawGap: gap(actual, nts), adjGap: gap(adj, nts), mixEffect: mixEff(actual, adj),
      adjustment: s.adjLabel,
    };
  }
  return out;
}

const FS_MIX = [
  { name: 'tnps', key: 'tnps', type: 'skuCust', mult: 100, adjLabel: 'SKU × CustType' },
  { name: 'cst', key: 'cst', type: 'skuCust', mult: 1, adjLabel: 'SKU × CustType' },
  { name: 'sqs', key: 'sqs', type: 'sku', mult: 100, adjLabel: 'SKU only' },
  { name: 'ir', key: 'ir', type: 'cust', mult: 100, adjLabel: 'CustType only' },
  { name: 'hc', key: 'hc', type: 'skuCust', mult: 100, adjLabel: 'SKU × CustType' },
];
const TTLA_MIX = [
  { name: 'tnps', key: 'tnps', type: 'skuCust', mult: 100, adjLabel: 'SKU × CustType' },
  { name: 'aht', key: 'aht', type: 'skuCust', mult: 1, adjLabel: 'SKU × CustType' },
  { name: 'sqs', key: 'sqs', type: 'sku', mult: 100, adjLabel: 'SKU only' },
  { name: 'ir', key: 'ir', type: 'cust', mult: 100, adjLabel: 'CustType only' },
];
const PL1_TRIAGE_MIX = [
  { name: 'tnps', key: 'tnps', type: 'sku', mult: 100, adjLabel: 'SKU within category' },
  { name: 'sqs', key: 'sqs', type: 'sku', mult: 100, adjLabel: 'SKU within category' },
  { name: 'ir', key: 'ir', type: 'cust', mult: 100, adjLabel: 'CustType only' },
];

function split(rows) { return { ts: rows.filter(isTS), nts: rows.filter(isNTS) }; }

function rawBlock(tsR, ntsR) {
  const keys = ['tnps', 'ir', 'sqs', 'hc', 'cst', 'aht'];
  const b = { ts: {}, nts: {} };
  for (const k of keys) {
    const m = k === 'tnps' || k === 'ir' || k === 'sqs' || k === 'hc' ? 100 : 1;
    if (sum(tsR, k === 'hc' ? 'handled_conversion_denominator' : `${k}_denominator`) > 0) b.ts[k] = fmt(ratio(tsR, k, m));
    if (sum(ntsR, k === 'hc' ? 'handled_conversion_denominator' : `${k}_denominator`) > 0) b.nts[k] = fmt(ratio(ntsR, k, m));
  }
  return b;
}

function fmtGap(n, lowerBetter = false) {
  if (n == null) return '—';
  const s = n > 0 ? `+${n}` : `${n}`;
  return s;
}

function mixRow(m, label, lowerBetter = false, skipIfNull = false) {
  if (skipIfNull && m.actual == null && m.adj == null) return '';
  const rg = m.rawGap, ag = m.adjGap;
  const rgCls = cls(rg, lowerBetter), agCls = cls(ag, lowerBetter);
  return `<tr><td><strong>${label}</strong></td><td>${m.actual ?? '—'}</td><td>${m.adj ?? '—'}</td><td>${m.nts ?? '—'}</td><td class="${rgCls}">${fmtGap(rg, lowerBetter)}</td><td class="${agCls}">${fmtGap(ag, lowerBetter)}</td><td>${fmtGap(m.mixEffect, lowerBetter)}</td><td>${m.adjustment.replace('×', '&times;')}</td></tr>`;
}

function mixTable(mix, order, lowerBetter = {}, skipIfNull = false) {
  return order.map((k) => mixRow(mix[k], k.toUpperCase() === 'AHT' ? 'AHT' : k === 'tnps' ? 'tNPS' : k.toUpperCase(), lowerBetter[k], skipIfNull)).filter(Boolean).join('\n');
}

function aggBy(rows, field, product) {
  const filtered = product ? rows.filter((r) => r.product_name === product) : rows;
  const vals = [...new Set(filtered.map((r) => r[field]).filter(Boolean))].sort();
  return vals.map((v) => {
    const sub = filtered.filter((r) => r[field] === v);
    const { ts, nts } = split(sub);
    return { key: v, ...rawBlock(ts, nts), tsExperts: new Set(ts.map((r) => r.corp_id)).size, ntsExperts: new Set(nts.map((r) => r.corp_id)).size };
  });
}

function forecastGroupTable(dp3Rows) {
  const fs = dp3Rows.filter((r) => r.product_name === FS);
  const cats = [...new Set(fs.map((r) => r.forecast_group_category).filter((c) => c && c !== 'NULL' && c !== 'CONCIERGE'))].sort();
  const { ts: allTs, nts: allNts } = split(fs);
  const tsTotal = sum(allTs, 'tnps_denominator');
  const ntsTotal = sum(allNts, 'tnps_denominator');
  return cats.map((cat) => {
    const sub = fs.filter((r) => r.forecast_group_category === cat);
    const { ts, nts } = split(sub);
    const tsSurv = sum(ts, 'tnps_denominator'), ntsSurv = sum(nts, 'tnps_denominator');
    const fmtIr = (rows) => { const v = ratio(rows, 'ir', 100); return v != null ? fmt(v) : null; };
    return {
      category: cat,
      ts: {
        surveys: tsSurv ? Math.round(tsSurv) : null,
        pct: tsTotal && tsSurv ? fmt((tsSurv / tsTotal) * 100, 1) : null,
        tnps: tsSurv ? fmt(ratio(ts, 'tnps', 100)) : null,
        ir: tsSurv ? fmtIr(ts) : null,
      },
      nts: {
        surveys: ntsSurv ? Math.round(ntsSurv) : null,
        pct: ntsTotal && ntsSurv ? fmt((ntsSurv / ntsTotal) * 100, 1) : null,
        tnps: ntsSurv ? fmt(ratio(nts, 'tnps', 100)) : null,
        ir: ntsSurv ? fmtIr(nts) : null,
      },
    };
  }).filter((row) => row.ts.surveys || row.nts.surveys);
}

function plStartTable(dp3Rows, product) {
  const rows = dp3Rows.filter((r) => r.product_name === product);
  return ['PL1', 'PL2', 'PL3', 'PL4'].map((pl) => {
    const sub = rows.filter((r) => r.proficiency_level_start === pl);
    const { ts, nts } = split(sub);
    return { pl, ...rawBlock(ts, nts) };
  });
}

function plEndTable(dpRows, product) {
  const rows = dpRows.filter((r) => r.product_name === product);
  return ['PL1', 'PL2', 'PL3', 'PL4'].map((pl) => {
    const sub = rows.filter((r) => r.proficiency_level === pl);
    const { ts, nts } = split(sub);
    return { pl, ...rawBlock(ts, nts) };
  });
}

function skuMixPct(rows) {
  const b = sum(rows, 'cst_basic_denominator');
  const d = sum(rows, 'cst_deluxe_denominator');
  const p = sum(rows, 'cst_premiun_denominator') || sum(rows, 'cst_premium_denominator');
  const t = b + d + p;
  return t ? { basic: fmt(b / t * 100, 1), deluxe: fmt(d / t * 100, 1), premium: fmt(p / t * 100, 1) } : null;
}

function metricBySku(rows, prefix, sku, mult = 100) {
  const nf = `${prefix}_${sku}_numerator`;
  const df = `${prefix}_${sku}_denominator`;
  const d = sum(rows, df);
  return d ? fmt(sum(rows, nf) / d * mult) : null;
}

function cstBySku(rows, sku) {
  const { num: nf, den: df } = skuMetricFields('cst', sku);
  const d = sum(rows, df);
  return d ? fmt(sum(rows, nf) / d) : null;
}

function cstMixAdjBySku(tsR, ntsR, sku) {
  let w = 0, t = 0;
  const { num: nf, den: df } = skuMetricFields('cst', sku);
  for (const c of CUST) {
    const tsC = tsR.filter((r) => r.new_returning_customer === c);
    const ntC = ntsR.filter((r) => r.new_returning_customer === c);
    const td = sum(tsC, df), nd = sum(ntC, df);
    if (!td || !nd) continue;
    w += (sum(tsC, nf) / td) * nd;
    t += nd;
  }
  return t ? fmt(w / t) : null;
}

function buildSkuInsight(tsR, ntsR) {
  const tsMix = skuMixPct(tsR);
  const ntsMix = skuMixPct(ntsR);
  const skus = SKUS.map((sku) => ({
    sku,
    tsMixPct: tsMix?.[sku],
    ntsMixPct: ntsMix?.[sku],
    tsTnps: metricBySku(tsR, 'tnps', sku),
    ntsTnps: metricBySku(ntsR, 'tnps', sku),
    tsCst: cstBySku(tsR, sku),
    tsCstAdj: cstMixAdjBySku(tsR, ntsR, sku),
    ntsCst: cstBySku(ntsR, sku),
  }));
  return {
    skus,
    overall: {
      tsTnps: fmt(ratio(tsR, 'tnps', 100)),
      ntsTnps: fmt(ratio(ntsR, 'tnps', 100)),
      tsCst: fmt(ratio(tsR, 'cst', 1)),
      tsCstAdj: fmt(skuCustMix(tsR, ntsR, 'cst', 1)),
      ntsCst: fmt(ratio(ntsR, 'cst', 1)),
    },
  };
}

function skuInsightHtml(insight) {
  const v = (x, pct = false) => (x == null ? '&mdash;' : pct ? `${x}%` : x);
  const bySku = (arr, field) => {
    const o = {};
    for (const r of arr) o[r.sku] = r[field];
    return o;
  };
  const tsMix = bySku(insight.skus, 'tsMixPct');
  const ntsMix = bySku(insight.skus, 'ntsMixPct');
  const tsTnps = bySku(insight.skus, 'tsTnps');
  const ntsTnps = bySku(insight.skus, 'ntsTnps');
  const tsCst = bySku(insight.skus, 'tsCst');
  const tsCstAdj = bySku(insight.skus, 'tsCstAdj');
  const ntsCst = bySku(insight.skus, 'ntsCst');
  const o = insight.overall;
  return `<tr class="ts-row"><td><strong>Tax Specialist</strong></td>` +
    `<td>${v(tsMix.basic, true)}</td><td>${v(tsMix.deluxe, true)}</td><td>${v(tsMix.premium, true)}</td>` +
    `<td>${v(tsTnps.basic)}</td><td>${v(tsTnps.deluxe)}</td><td>${v(tsTnps.premium)}</td>` +
    `<td>${v(tsCst.basic)}</td><td>${v(tsCstAdj.basic)}</td>` +
    `<td>${v(tsCst.deluxe)}</td><td>${v(tsCstAdj.deluxe)}</td>` +
    `<td>${v(tsCst.premium)}</td><td>${v(tsCstAdj.premium)}</td>` +
    `<td>${v(o.tsCst)}</td><td>${v(o.tsCstAdj)}</td></tr>\n` +
    `<tr class="highlight-row"><td><strong>Non-TS</strong></td>` +
    `<td>${v(ntsMix.basic, true)}</td><td>${v(ntsMix.deluxe, true)}</td><td>${v(ntsMix.premium, true)}</td>` +
    `<td>${v(ntsTnps.basic)}</td><td>${v(ntsTnps.deluxe)}</td><td>${v(ntsTnps.premium)}</td>` +
    `<td>${v(ntsCst.basic)}</td><td>&mdash;</td>` +
    `<td>${v(ntsCst.deluxe)}</td><td>&mdash;</td>` +
    `<td>${v(ntsCst.premium)}</td><td>&mdash;</td>` +
    `<td>${v(o.ntsCst)}</td><td>&mdash;</td></tr>`;
}

function m2Html(table, product) {
  const isFs = product === FS;
  const v = (x) => (x == null ? '&mdash;' : x);
  return table.map((m) => {
    if (isFs) {
      return `<tr><td rowspan="2"><strong>${m.manager}</strong></td><td style="text-align:center;">TS</td><td>${m.tsE}</td><td>${v(m.ts.tnps)}</td><td>${v(m.ts.ir)}</td><td>${v(m.ts.sqs)}</td><td>${v(m.ts.hc)}</td><td>${v(m.ts.cst)}</td></tr>\n<tr><td style="text-align:center;">Non-TS</td><td>${m.ntsE}</td><td>${v(m.nts.tnps)}</td><td>${v(m.nts.ir)}</td><td>${v(m.nts.sqs)}</td><td>${v(m.nts.hc)}</td><td>${v(m.nts.cst)}</td></tr>`;
    }
    return `<tr><td rowspan="2"><strong>${m.manager}</strong></td><td style="text-align:center;">TS</td><td>${m.tsE}</td><td>${v(m.ts.tnps)}</td><td>${v(m.ts.ir)}</td><td>${v(m.ts.sqs)}</td><td>${v(m.ts.aht)}</td></tr>\n<tr><td style="text-align:center;">Non-TS</td><td>${m.ntsE}</td><td>${v(m.nts.tnps)}</td><td>${v(m.nts.ir)}</td><td>${v(m.nts.sqs)}</td><td>${v(m.nts.aht)}</td></tr>`;
  }).join('\n');
}
function m2Table(dpRows, product, minTs = 5, minNts = 50) {
  const rows = dpRows.filter((r) => r.product_name === product && r.manager_name_m2);
  const managers = [...new Set(rows.map((r) => r.manager_name_m2))];
  const out = [];
  for (const m of managers) {
    const sub = rows.filter((r) => r.manager_name_m2 === m);
    const { ts, nts } = split(sub);
    const tsE = new Set(ts.map((r) => r.corp_id)).size;
    const ntsE = new Set(nts.map((r) => r.corp_id)).size;
    if (tsE < minTs && ntsE < minNts) continue;
    const vol = sum(ts, 'cst_denominator') + sum(nts, 'cst_denominator');
    out.push({ manager: m, tsE, ntsE, vol, ts: rawBlock(ts, nts).ts, nts: rawBlock(ts, nts).nts });
  }
  return out.sort((a, b) => b.vol - a.vol);
}

function trainingWaveTable(dpRows, product) {
  const rows = dpRows.filter((r) => r.product_name === product && r.hire_type === 'New Hire' && r.NH_training_wave);
  const waves = [...new Set(rows.map((r) => r.NH_training_wave))].filter((w) => w && w !== 'null').sort();
  return waves.map((w) => {
    const sub = rows.filter((r) => r.NH_training_wave === w);
    const { ts, nts } = split(sub);
    return { wave: w, tsE: new Set(ts.map((r) => r.corp_id)).size, ntsE: new Set(nts.map((r) => r.corp_id)).size, ...rawBlock(ts, nts) };
  });
}

function expertCounts(dpRows) {
  const fs = dpRows.filter((r) => r.product_name === FS);
  const ttla = dpRows.filter((r) => r.product_name === TTLA);
  function counts(rows) {
    const tsIds = new Set(rows.filter(isTS).map((r) => r.corp_id));
    const ntsIds = new Set(rows.filter(isNTS).map((r) => r.corp_id));
    const tsEng = sum(rows.filter(isTS), 'cst_denominator');
    const ntsEng = sum(rows.filter(isNTS), 'cst_denominator');
    const totalE = new Set(rows.map((r) => r.corp_id)).size;
    const totalEng = tsEng + ntsEng;
    return {
      tsExperts: tsIds.size, ntsExperts: ntsIds.size, totalExperts: totalE,
      tsEngPct: fmt(totalEng ? (tsEng / totalEng) * 100 : 0, 1),
      ntsEngPct: fmt(totalEng ? (ntsEng / totalEng) * 100 : 0, 1),
      tsExpertPct: fmt(totalE ? (tsIds.size / totalE) * 100 : 0, 1),
      ntsExpertPct: fmt(totalE ? (ntsIds.size / totalE) * 100 : 0, 1),
    };
  }
  return { fs: counts(fs), ttla: counts(ttla) };
}

const dp = loadCsv(DP);
const dp2 = loadCsv(DP2);
const dp3 = loadCsv(DP3);

const fsDP = dp.filter((r) => r.product_name === FS);
const ttlaDP = dp.filter((r) => r.product_name === TTLA);
const fsDP3 = dp3.filter((r) => r.product_name === FS);
const ttlaDP3 = dp3.filter((r) => r.product_name === TTLA);

const fsSplit = split(fsDP);
const ttlaSplit = split(ttlaDP);
const fsOverall = rawBlock(fsSplit.ts, fsSplit.nts);
const ttlaOverall = rawBlock(ttlaSplit.ts, ttlaSplit.nts);

const pl1Fs = dp3.filter((r) => r.product_name === FS && isPL1NH(r));
const pl1Ttla = dp3.filter((r) => r.product_name === TTLA && isPL1NH(r));
const pl1FsSplit = split(pl1Fs);
const pl1TtlaSplit = split(pl1Ttla);

function pl1TriageMix(product, triage) {
  const rows = dp3.filter((r) => r.product_name === product && isPL1NH(r) && (triage ? isTriageAmend(r) : isNonTriage(r)));
  const { ts, nts } = split(rows);
  return {
    mix: buildMix(ts, nts, PL1_TRIAGE_MIX),
    tsSurveys: Math.round(sum(ts, 'tnps_denominator')),
    ntsSurveys: Math.round(sum(nts, 'tnps_denominator')),
  };
}

const pl1Triage = pl1TriageMix(FS, true);
const pl1NonTriage = pl1TriageMix(FS, false);
const pl1TsSurv = sum(pl1FsSplit.ts, 'tnps_denominator');
const pl1NtsSurv = sum(pl1FsSplit.nts, 'tnps_denominator');

const fsDP3Split = split(fsDP3);

const report = {
  generated: new Date().toISOString(),
  sources: { dp: dp.length, dp2: dp2.length, dp3: dp3.length },
  overall: { fs: fsOverall, ttla: ttlaOverall },
  expertCounts: expertCounts(dp),
  mixAppendix: {
    fs: buildMix(split(fsDP3).ts, split(fsDP3).nts, FS_MIX),
    ttla: buildMix(split(ttlaDP3).ts, split(ttlaDP3).nts, TTLA_MIX),
  },
  pl1: {
    raw: { fs: rawBlock(pl1FsSplit.ts, pl1FsSplit.nts), ttla: rawBlock(pl1TtlaSplit.ts, pl1TtlaSplit.nts) },
    mix: {
      fs: buildMix(pl1FsSplit.ts, pl1FsSplit.nts, FS_MIX),
      ttla: buildMix(pl1TtlaSplit.ts, pl1TtlaSplit.nts, TTLA_MIX),
    },
    triage: pl1Triage,
    nonTriage: pl1NonTriage,
    triagePct: {
      ts: fmt(pl1TsSurv ? (pl1Triage.tsSurveys / pl1TsSurv) * 100 : 0, 1),
      nts: fmt(pl1NtsSurv ? (pl1Triage.ntsSurveys / pl1NtsSurv) * 100 : 0, 1),
    },
  },
  triageAllPL: {
    triage: buildMix(split(filterDP3Triage(fsDP3, true)).ts, split(filterDP3Triage(fsDP3, true)).nts,
      [{ name: 'tnps', key: 'tnps', type: 'sku', mult: 100, adjLabel: 'SKU' }]).tnps,
    nonTriage: buildMix(split(filterDP3Triage(fsDP3, false)).ts, split(filterDP3Triage(fsDP3, false)).nts,
      [{ name: 'tnps', key: 'tnps', type: 'sku', mult: 100, adjLabel: 'SKU' }]).tnps,
  },
  forecastGroup: forecastGroupTable(dp3),
  plEnd: { fs: plEndTable(dp, FS), ttla: plEndTable(dp, TTLA) },
  plStart: { fs: plStartTable(dp3, FS), ttla: plStartTable(dp3, TTLA) },
  skuMix: { fs: { ts: skuMixPct(fsDP3Split.ts), nts: skuMixPct(fsDP3Split.nts) } },
  skuInsight: buildSkuInsight(fsDP3Split.ts, fsDP3Split.nts),
  m2: { fs: m2Table(dp, FS), ttla: m2Table(dp, TTLA) },
  trainingWave: { fs: trainingWaveTable(dp, FS), ttla: trainingWaveTable(dp, TTLA) },
  html: {},
};

function filterDP3Triage(rows, triage) {
  return rows.filter((r) => triage ? isTriageAmend(r) : isNonTriage(r));
}

// HTML fragments for mix tables
report.html.fsMixAppendix = mixTable(report.mixAppendix.fs, ['tnps', 'cst', 'sqs', 'ir', 'hc'], { cst: true });
report.html.ttlaMixAppendix = mixTable(report.mixAppendix.ttla, ['tnps', 'aht', 'sqs', 'ir']);
report.html.pl1FsMix = mixTable(report.pl1.mix.fs, ['tnps', 'cst', 'sqs', 'ir', 'hc'], { cst: true });
report.html.pl1TtlaMix = mixTable(report.pl1.mix.ttla, ['tnps', 'aht', 'sqs', 'ir']);
report.html.pl1TriageMix = mixTable(report.pl1.triage.mix, ['tnps', 'sqs', 'ir'], {}, true);
report.html.pl1NonTriageMix = mixTable(report.pl1.nonTriage.mix, ['tnps', 'sqs', 'ir'], {}, true);
report.html.skuInsightSummary = skuInsightHtml(report.skuInsight);

function cell(v) { return v == null || v === 0 && v !== '0' ? '&mdash;' : v; }
function fgRows(fg) {
  return fg.map((row) => {
    const c = row.category;
    const ts = row.ts, nts = row.nts;
    const fmtN = (n) => (n == null ? '&mdash;' : Number(n).toLocaleString('en-US'));
    const fmtP = (p) => (p == null ? '&mdash;' : `${p}%`);
    const fmtM = (m) => (m == null ? '&mdash;' : m);
    return `<tr><td rowspan="2"><strong>${c}</strong></td><td style="text-align:center;">TS</td><td>${fmtN(ts.surveys)}</td><td>${fmtP(ts.pct)}</td><td>${fmtM(ts.tnps)}</td><td>${fmtM(ts.ir)}</td></tr>\n<tr><td style="text-align:center;">Non-TS</td><td>${fmtN(nts.surveys)}</td><td>${fmtP(nts.pct)}</td><td>${fmtM(nts.tnps)}</td><td>${fmtM(nts.ir)}</td></tr>`;
  }).join('\n');
}
report.html.forecastGroup = fgRows(report.forecastGroup);
report.html.m2Fs = m2Html(report.m2.fs, FS);
report.html.m2Ttla = m2Html(report.m2.ttla, TTLA);
report.totals = {
  tsSurveys: Math.round(sum(split(fsDP3).ts, 'tnps_denominator')),
  ntsSurveys: Math.round(sum(split(fsDP3).nts, 'tnps_denominator')),
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('Wrote', OUT);
console.log('FS overall TS:', fsOverall.ts);
console.log('FS mix HC adj gap:', report.pl1.mix.fs.hc.adjGap);
console.log('FS mix SQS adj:', report.mixAppendix.fs.sqs.adj);
