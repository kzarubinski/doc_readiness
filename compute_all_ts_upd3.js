'use strict';

const fs = require('fs');

const OVERALL_PATH =
  'c:\\Users\\kzarubinski\\Cursor\\data_ts_overall_upd3.tsv';
const DETAIL_PATH =
  'c:\\Users\\kzarubinski\\Cursor\\data_ts_detail_upd3.tsv';
const OUT_PATH = 'c:\\Users\\kzarubinski\\Cursor\\ts_upd3_output.txt';

const lines = [];

function log(...args) {
  const s = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  lines.push(s);
  console.log(s);
}

function loadTSV(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const d = raw.split(/\r?\n/);
  const h = d[0].split('\t').map((s) => s.trim());
  return d.slice(1).filter(Boolean).map((l) => {
    const v = l.split('\t');
    const o = {};
    h.forEach((k, i) => {
      o[k] = v[i] !== undefined ? v[i].trim() : '';
    });
    return o;
  });
}

function isMissing(v) {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  if (s === '' || s === 'null' || s === 'NaN' || s === 'null%') return true;
  return false;
}

function num(v) {
  if (isMissing(v)) return null;
  const n = parseFloat(String(v).replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'N/A';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function emptyAccOverall() {
  return {
    expert_cnt: 0,
    fs_cst_num: 0,
    fs_eng: 0,
    exec_fs_tnps_num: 0,
    exec_fs_tnps_denom: 0,
    ttla_handle_min: 0,
    ttla_handle_cnt: 0,
    exec_ttla_tnps_num: 0,
    exec_ttla_tnps_denom: 0,
    conv_num: 0,
    conv_denom: 0,
    basic_cst: 0,
    basic_eng: 0,
    deluxe_cst: 0,
    deluxe_eng: 0,
    premium_cst: 0,
    premium_eng: 0,
    other_cst: 0,
    other_eng: 0,
  };
}

function addOverallRow(acc, r) {
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
  // TTLA AHT and TTLA tNPS: omit rows where handle count is empty or zero
  if (tm !== null && tc !== null && tc > 0) {
    acc.ttla_handle_min += tm;
    acc.ttla_handle_cnt += tc;
    const tn = num(r.exec_ttla_tnps_num);
    const td = num(r.exec_ttla_tnps_denom);
    if (tn !== null && td !== null) {
      acc.exec_ttla_tnps_num += tn;
      acc.exec_ttla_tnps_denom += td;
    }
  }

  const cvn = num(r.conv_num);
  const cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) {
    acc.conv_num += cvn;
    acc.conv_denom += cvd;
  }

  const pairs = [
    ['basic_cst', 'basic_eng'],
    ['deluxe_cst', 'deluxe_eng'],
    ['premium_cst', 'premium_eng'],
    ['other_cst', 'other_eng'],
  ];
  for (const [ck, ek] of pairs) {
    const c = num(r[ck]);
    const e = num(r[ek]);
    if (c !== null && e !== null) {
      acc[ck] += c;
      acc[ek] += e;
    }
  }

  return acc;
}

function aggOverall(rows) {
  return rows.reduce(addOverallRow, emptyAccOverall());
}

function metricsFromOverallAcc(a) {
  const cst = a.fs_eng > 0 ? a.fs_cst_num / a.fs_eng : null;
  const fsTnps =
    a.exec_fs_tnps_denom > 0
      ? (a.exec_fs_tnps_num / a.exec_fs_tnps_denom) * 100
      : null;
  const ttlaAht =
    a.ttla_handle_cnt > 0 ? a.ttla_handle_min / a.ttla_handle_cnt : null;
  const ttlaTnps =
    a.exec_ttla_tnps_denom > 0
      ? (a.exec_ttla_tnps_num / a.exec_ttla_tnps_denom) * 100
      : null;
  const conv =
    a.conv_denom > 0 ? (a.conv_num / a.conv_denom) * 100 : null;
  return { cst, fsTnps, ttlaAht, ttlaTnps, conv };
}

function printOverallBlock(title, a, opts = {}) {
  const withSku = opts.withSku !== false;
  log(title);
  log(`  expert_cnt: ${round2(a.expert_cnt)}`);
  log(`  fs_eng (summed): ${round2(a.fs_eng)}`);
  const m = metricsFromOverallAcc(a);
  log(`  FS CST: ${round2(m.cst)}`);
  log(`  FS tNPS: ${round2(m.fsTnps)}`);
  log(`  TTLA AHT: ${round2(m.ttlaAht)}`);
  log(`  TTLA tNPS: ${round2(m.ttlaTnps)}`);
  log(`  Conv Rate: ${round2(m.conv)}%`);

  if (!withSku) {
    log('');
    return;
  }

  const be = a.basic_eng;
  const de = a.deluxe_eng;
  const pe = a.premium_eng;
  const oe = a.other_eng;
  const totalSku = be + de + pe + oe;
  const pct = (x) => (totalSku > 0 ? (x / totalSku) * 100 : null);
  log('  SKU mix (% of total SKU eng):');
  log(
    `    basic_eng: ${round2(pct(be))}% | deluxe_eng: ${round2(pct(de))}% | premium_eng: ${round2(pct(pe))}% | other_eng: ${round2(pct(oe))}%`
  );
  log(
    `    (counts) basic_eng=${round2(be)}, deluxe_eng=${round2(de)}, premium_eng=${round2(pe)}, other_eng=${round2(oe)}`
  );
  const cBasic = be > 0 ? a.basic_cst / be : null;
  const cDeluxe = de > 0 ? a.deluxe_cst / de : null;
  const cPrem = pe > 0 ? a.premium_cst / pe : null;
  const cOther = oe > 0 ? a.other_cst / oe : null;
  log('  Per-SKU FS CST:');
  log(
    `    Basic: ${round2(cBasic)} | Deluxe: ${round2(cDeluxe)} | Premium: ${round2(cPrem)} | Other: ${round2(cOther)}`
  );
  log('');
}

/** Detail: expert_cnt, CST, FS tNPS, conv, TTLA AHT only */
function emptyAccDetail() {
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

function addDetailRow(acc, r) {
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
  if (tm !== null && tc !== null && tc > 0) {
    acc.ttla_handle_min += tm;
    acc.ttla_handle_cnt += tc;
  }

  const cvn = num(r.conv_num);
  const cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) {
    acc.conv_num += cvn;
    acc.conv_denom += cvd;
  }

  return acc;
}

function aggDetail(rows) {
  return rows.reduce(addDetailRow, emptyAccDetail());
}

function detailMetricsFromAcc(a) {
  const cst = a.fs_eng > 0 ? a.fs_cst_num / a.fs_eng : null;
  const fsTnps =
    a.exec_fs_tnps_denom > 0
      ? (a.exec_fs_tnps_num / a.exec_fs_tnps_denom) * 100
      : null;
  const ttlaAht =
    a.ttla_handle_cnt > 0 ? a.ttla_handle_min / a.ttla_handle_cnt : null;
  const conv =
    a.conv_denom > 0 ? (a.conv_num / a.conv_denom) * 100 : null;
  return { cst, fsTnps, ttlaAht, conv };
}

function printDetailLine(label, a) {
  const m = detailMetricsFromAcc(a);
  log(
    `  ${label} | expert_cnt=${round2(a.expert_cnt)} | FS CST=${round2(m.cst)} | FS tNPS=${round2(m.fsTnps)} | Conv%=${round2(m.conv)} | TTLA AHT=${round2(m.ttlaAht)} | fs_eng=${round2(a.fs_eng)}`
  );
}

/** Wave sort helper */
const WAVE_ORDER = ['Wave 3', 'Wave 4', 'Wave 5', 'Wave 6', 'Wave 7', 'Re-Hire'];

function waveSortKey(w) {
  const i = WAVE_ORDER.indexOf(w);
  if (i >= 0) return i;
  const m = /^Wave\s+(\d+)/i.exec(w || '');
  if (m) return 100 + parseInt(m[1], 10);
  return 999;
}

function sortWaveKeys(keys) {
  return [...keys].sort((a, b) => {
    const da = waveSortKey(a);
    const db = waveSortKey(b);
    if (da !== db) return da - db;
    return String(a).localeCompare(String(b));
  });
}

/**
 * Build 1–2 sentence key findings from grouped detail rows.
 * @param {string} dimTitle
 * @param {Array<{k:string, rows: object[]}>} groups
 */
function logKeyFindings(dimTitle, groups) {
  const entries = groups
    .map(({ k, rows }) => {
      const a = aggDetail(rows);
      return { label: k, ...detailMetricsFromAcc(a), expert_cnt: a.expert_cnt, fs_eng: a.fs_eng };
    })
    .filter((e) => e.expert_cnt > 0);

  if (entries.length === 0) {
    log(`  Key Findings (${dimTitle}): No rows after filters.`);
    log('');
    return;
  }

  const total = entries.reduce((s, e) => s + e.expert_cnt, 0);
  entries.sort((a, b) => b.expert_cnt - a.expert_cnt);
  const top = entries[0];
  const topPct = total > 0 ? (top.expert_cnt / total) * 100 : 0;

  const threshold = Math.max(5, total * 0.05);
  const meaty = entries.filter((e) => e.expert_cnt >= threshold);
  const cstPool = meaty.filter((e) => e.cst !== null);
  let cstRange = '';
  if (cstPool.length >= 2) {
    const byCst = [...cstPool].sort((a, b) => a.cst - b.cst);
    const lo = byCst[0];
    const hi = byCst[byCst.length - 1];
    if (lo.label !== hi.label) {
      cstRange = ` FS CST is lowest in "${lo.label}" (${round2(lo.cst)}) and highest in "${hi.label}" (${round2(hi.cst)}).`;
    }
  }

  const convPool = meaty.filter((e) => e.conv !== null);
  let convNote = '';
  if (convPool.length >= 2) {
    const byCv = [...convPool].sort((a, b) => a.conv - b.conv);
    const loC = byCv[0];
    const hiC = byCv[byCv.length - 1];
    if (loC.label !== hiC.label) {
      convNote =
        ` Conv rate spans ${round2(loC.conv)}% ("${loC.label}") to ${round2(hiC.conv)}% ("${hiC.label}").`;
    }
  }

  const tnpsPool = meaty.filter((e) => e.fsTnps !== null);
  let tnpsNote = '';
  if (tnpsPool.length >= 2) {
    const byT = [...tnpsPool].sort((a, b) => a.fsTnps - b.fsTnps);
    const loT = byT[0];
    const hiT = byT[byT.length - 1];
    if (loT.label !== hiT.label) {
      tnpsNote = ` FS tNPS is lowest in "${loT.label}" (${round2(loT.fsTnps)}) and highest in "${hiT.label}" (${round2(hiT.fsTnps)}).`;
    }
  }

  const ahtPool = meaty.filter((e) => e.ttlaAht !== null);
  let ahtNote = '';
  if (ahtPool.length >= 2) {
    const byA = [...ahtPool].sort((a, b) => a.ttlaAht - b.ttlaAht);
    const loA = byA[0];
    const hiA = byA[byA.length - 1];
    if (loA.label !== hiA.label) {
      ahtNote = ` TTLA AHT is shortest in "${loA.label}" (${round2(loA.ttlaAht)} min) and longest in "${hiA.label}" (${round2(hiA.ttlaAht)} min).`;
    }
  }

  const extras = [tnpsNote, convNote, cstRange, ahtNote].filter(
    (s) => s && String(s).trim()
  );
  const insight = extras.length ? extras.slice(0, 2).join('') : '';
  log(
    `  Key Findings (${dimTitle}): Headcount concentrates in "${top.label}" (${round2(top.expert_cnt)} experts, ${round2(topPct)}% of experts in this dimension).${insight}`
  );
  if (!insight && entries.length === 1) {
    log(
      `  (Only one segment met filters; metrics are for that segment alone.)`
    );
  }
  log('');
}

function groupBy(rows, keyFn, skipFn) {
  const m = {};
  for (const r of rows) {
    const raw = keyFn(r);
    if (skipFn && skipFn(raw)) continue;
    const k = String(raw).trim();
    if (!m[k]) m[k] = [];
    m[k].push(r);
  }
  return m;
}

function main() {
  const overall = loadTSV(OVERALL_PATH);
  const detail = loadTSV(DETAIL_PATH);

  const nonP = overall.filter((r) => r.expert_type === 'NonPathEDU');
  const pathP = overall.filter((r) => r.expert_type === 'PathEDU');

  log('='.repeat(80));
  log('TS Analysis — data_ts_overall_upd3.tsv + data_ts_detail_upd3.tsv');
  log('='.repeat(80));
  log('');

  log('--- SECTION A: OVERALL — NonPathEDU vs PathEDU ---');
  log('');
  printOverallBlock('NonPathEDU — Overall', aggOverall(nonP));
  printOverallBlock('PathEDU — Overall', aggOverall(pathP));

  log('--- SECTION B: BY HIRE TYPE (New Hire / Re-Hire), BOTH GROUPS ---');
  log('');
  printOverallBlock(
    'NonPathEDU — New Hire',
    aggOverall(nonP.filter((r) => r.hire_type === 'New Hire'))
  );
  printOverallBlock(
    'NonPathEDU — Re-Hire',
    aggOverall(nonP.filter((r) => r.hire_type === 'Re-Hire'))
  );
  printOverallBlock(
    'PathEDU — New Hire',
    aggOverall(pathP.filter((r) => r.hire_type === 'New Hire'))
  );
  printOverallBlock(
    'PathEDU — Re-Hire',
    aggOverall(pathP.filter((r) => r.hire_type === 'Re-Hire'))
  );

  log('--- SECTION C: FS_ENG TOTALS (summed from overall rows, matches blocks above) ---');
  log('');
  const gLabel = [
    ['NonPathEDU — Overall', nonP],
    ['PathEDU — Overall', pathP],
    ['NonPathEDU — New Hire', nonP.filter((r) => r.hire_type === 'New Hire')],
    ['NonPathEDU — Re-Hire', nonP.filter((r) => r.hire_type === 'Re-Hire')],
    ['PathEDU — New Hire', pathP.filter((r) => r.hire_type === 'New Hire')],
    ['PathEDU — Re-Hire', pathP.filter((r) => r.hire_type === 'Re-Hire')],
  ];
  for (const [label, rows] of gLabel) {
    const fs = aggOverall(rows).fs_eng;
    log(`  ${label}: fs_eng sum = ${round2(fs)}`);
  }
  log('');

  log('--- SECTION D: PATHEDU PARTNER BREAKDOWN (overall file) ---');
  log('');
  const partnerKeys = [
    ...new Set(pathP.map((r) => r.partner_name).filter((x) => !isMissing(x))),
  ].sort();
  for (const pk of partnerKeys) {
    printOverallBlock(
      `PathEDU — partner_name = ${pk}`,
      aggOverall(pathP.filter((r) => r.partner_name === pk))
    );
  }

  log('--- SECTION E: PATHEDU WAVE BREAKDOWN (overall file) ---');
  log('');
  const waveKeysOverall = sortWaveKeys([
    ...new Set(pathP.map((r) => r.training_wave).filter((x) => !isMissing(x))),
  ]);
  for (const w of waveKeysOverall) {
    printOverallBlock(
      `PathEDU — training_wave = ${w}`,
      aggOverall(pathP.filter((r) => r.training_wave === w))
    );
  }

  const pathDetail = detail.filter((r) => r.expert_type === 'PathEDU');

  log('--- SECTION F: DETAIL BREAKDOWNS (PathEDU only, data_ts_detail_upd3.tsv) ---');
  log('');

  function runDetailDim(sectionTitle, dimName, groupMap) {
    log(`--- ${sectionTitle} ---`);
    log('');
    const entries = Object.keys(groupMap).map((k) => {
      const rows = groupMap[k];
      return { k, rows, acc: aggDetail(rows) };
    });
    entries.sort((a, b) => {
      if (b.acc.expert_cnt !== a.acc.expert_cnt) {
        return b.acc.expert_cnt - a.acc.expert_cnt;
      }
      if (dimName === 'training_wave') {
        const wa = waveSortKey(a.k);
        const wb = waveSortKey(b.k);
        if (wa !== wb) return wa - wb;
      }
      return String(a.k).localeCompare(String(b.k));
    });
    const groupList = entries.map(({ k, rows }) => ({ k, rows }));
    for (const { k, acc } of entries) {
      printDetailLine(`${dimName} = ${k}`, acc);
    }
    logKeyFindings(dimName, groupList);
  }

  const byPartner = groupBy(pathDetail, (r) => r.partner_name, isMissing);
  runDetailDim('F1. Partner (partner_name)', 'partner_name', byPartner);

  const byUni = groupBy(pathDetail, (r) => r.university, isMissing);
  runDetailDim('F2. University (university)', 'university', byUni);

  const byAttr = groupBy(pathDetail, (r) => r.attr_status_adj, isMissing);
  runDetailDim(
    'F3. Attrition stage (attr_status_adj)',
    'attr_status_adj',
    byAttr
  );

  const byWaveD = groupBy(pathDetail, (r) => r.training_wave, isMissing);
  runDetailDim(
    'F4. Training wave (training_wave)',
    'training_wave',
    byWaveD
  );

  const byGrad = groupBy(pathDetail, (r) => r.grad_year, isMissing);
  runDetailDim('F5. Graduation year (grad_year)', 'grad_year', byGrad);

  const byMajor = groupBy(pathDetail, (r) => r.major, isMissing);
  runDetailDim('F6. Major', 'major', byMajor);

  const byRemote = groupBy(pathDetail, (r) => r.remote, isMissing);
  runDetailDim('F7. Working location (remote)', 'remote', byRemote);

  log(`(Output file written: ${OUT_PATH})`);
  fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n', 'utf8');
}

main();
