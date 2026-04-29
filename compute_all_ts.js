const fs = require('fs');

function parseTSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = vals[i] ? vals[i].trim() : '';
    });
    return obj;
  });
}

function num(v) {
  if (!v || v === 'null' || v === '' || v === 'NaN') return null;
  const s = v.replace('%', '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function sumField(rows, field) {
  let s = 0;
  for (const r of rows) {
    const v = num(r[field]);
    if (v !== null) s += v;
  }
  return s;
}

function weightedAvg(numF, denomF, rows) {
  let n = 0, d = 0;
  for (const r of rows) {
    const nv = num(r[numF]), dv = num(r[denomF]);
    if (nv !== null && dv !== null && dv > 0) { n += nv; d += dv; }
  }
  return d > 0 ? { num: n, denom: d, val: n / d } : { num: 0, denom: 0, val: null };
}

function computeGroup(rows) {
  const experts = sumField(rows, 'expert_cnt');
  const cst = weightedAvg('fs_cst_num', 'fs_eng', rows);
  const tnps = weightedAvg('fs_tnps_num', 'fs_tnps_denom', rows);
  const aht = weightedAvg('ttla_handle_min', 'ttla_handle_cnt', rows);
  const ttla_tnps = weightedAvg('ttla_tnps_num', 'ttla_tnps_denom', rows);
  const conv = weightedAvg('conv_num', 'conv_denom', rows);
  const basic_cst = weightedAvg('basic_cst', 'basic_eng', rows);
  const deluxe_cst = weightedAvg('deluxe_cst', 'deluxe_eng', rows);
  const premium_cst = weightedAvg('premium_cst', 'premium_eng', rows);

  // SKU mix
  let basic_eng = 0, deluxe_eng = 0, premium_eng = 0, total_sku_eng = 0;
  for (const r of rows) {
    const b = num(r['basic_eng']), d = num(r['deluxe_eng']), p = num(r['premium_eng']);
    if (b !== null) basic_eng += b;
    if (d !== null) deluxe_eng += d;
    if (p !== null) premium_eng += p;
  }
  total_sku_eng = basic_eng + deluxe_eng + premium_eng;

  return {
    experts,
    fs_eng: cst.denom,
    fs_cst: cst.denom > 0 ? cst.num / cst.denom : null,
    fs_cst_num: cst.num,
    fs_tnps: tnps.denom > 0 ? (tnps.num / tnps.denom * 100) : null,
    fs_tnps_num: tnps.num, fs_tnps_denom: tnps.denom,
    ttla_aht: aht.denom > 0 ? aht.num / aht.denom : null,
    ttla_handle_min: aht.num, ttla_handle_cnt: aht.denom,
    ttla_tnps: ttla_tnps.denom > 0 ? (ttla_tnps.num / ttla_tnps.denom * 100) : null,
    ttla_tnps_num: ttla_tnps.num, ttla_tnps_denom: ttla_tnps.denom,
    conv_rate: conv.denom > 0 ? (conv.num / conv.denom * 100) : null,
    conv_num: conv.num, conv_denom: conv.denom,
    basic_eng, deluxe_eng, premium_eng, total_sku_eng,
    basic_pct: total_sku_eng > 0 ? (basic_eng / total_sku_eng * 100) : null,
    deluxe_pct: total_sku_eng > 0 ? (deluxe_eng / total_sku_eng * 100) : null,
    premium_pct: total_sku_eng > 0 ? (premium_eng / total_sku_eng * 100) : null,
    basic_cst: basic_cst.val, deluxe_cst: deluxe_cst.val, premium_cst: premium_cst.val
  };
}

function fmt(v, dec=2) { return v !== null && v !== undefined ? v.toFixed(dec) : 'N/A'; }

const data = parseTSV('data_ts_overall.tsv');

const nonP = data.filter(r => r.expert_type === 'NonPathEDU');
const pathE = data.filter(r => r.expert_type === 'PathEDU');
const nonP_NH = nonP.filter(r => r.hire_type === 'New Hire');
const nonP_RH = nonP.filter(r => r.hire_type === 'Re-Hire');
const pathE_NH = pathE.filter(r => r.hire_type === 'New Hire');
const pathE_RH = pathE.filter(r => r.hire_type === 'Re-Hire');

console.log('=== SECTION 3a: OVERALL ===');
const overall_nonP = computeGroup(nonP);
const overall_pathE = computeGroup(pathE);
console.log('NonPathEDU:', JSON.stringify(overall_nonP));
console.log('PathEDU:', JSON.stringify(overall_pathE));

console.log('\n=== SECTION 3b: SKU MIX ===');
console.log('NonPathEDU SKU: Basic=' + fmt(overall_nonP.basic_pct) + '% Deluxe=' + fmt(overall_nonP.deluxe_pct) + '% Premium=' + fmt(overall_nonP.premium_pct) + '%');
console.log('PathEDU SKU: Basic=' + fmt(overall_pathE.basic_pct) + '% Deluxe=' + fmt(overall_pathE.deluxe_pct) + '% Premium=' + fmt(overall_pathE.premium_pct) + '%');
console.log('NonPathEDU CST by SKU: Basic=' + fmt(overall_nonP.basic_cst) + ' Deluxe=' + fmt(overall_nonP.deluxe_cst) + ' Premium=' + fmt(overall_nonP.premium_cst));
console.log('PathEDU CST by SKU: Basic=' + fmt(overall_pathE.basic_cst) + ' Deluxe=' + fmt(overall_pathE.deluxe_cst) + ' Premium=' + fmt(overall_pathE.premium_cst));

console.log('\n=== SECTION 3c: NEW HIRE vs RE-HIRE ===');
const nh_nonP = computeGroup(nonP_NH);
const rh_nonP = computeGroup(nonP_RH);
const nh_pathE = computeGroup(pathE_NH);
const rh_pathE = computeGroup(pathE_RH);
console.log('NonPathEDU NH:', JSON.stringify(nh_nonP));
console.log('NonPathEDU RH:', JSON.stringify(rh_nonP));
console.log('PathEDU NH:', JSON.stringify(nh_pathE));
console.log('PathEDU RH:', JSON.stringify(rh_pathE));

console.log('\n=== SECTION 3d: TRAINING WAVE (NH only) ===');
const pathWaves = ['Wave 3', 'Wave 4', 'Wave 5', 'Wave 6', 'Wave 7'];
for (const w of pathWaves) {
  const pRows = pathE_NH.filter(r => r.training_wave === w);
  if (pRows.length > 0) {
    const g = computeGroup(pRows);
    console.log('PathEDU NH ' + w + ':', JSON.stringify(g));
  }
}
const nonPWaves = ['Wave 5', 'Wave 6', 'Wave 7'];
for (const w of nonPWaves) {
  const nRows = nonP_NH.filter(r => r.training_wave === w);
  if (nRows.length > 0) {
    const g = computeGroup(nRows);
    console.log('NonPathEDU NH ' + w + ':', JSON.stringify(g));
  }
}

console.log('\n=== SECTION 3d2: TRAINING WAVE by PARTNER (NH only) ===');
const eawWaves = pathE_NH.filter(r => r.partner_name === 'EDUCATION AT WORK');
const fndWaves = pathE_NH.filter(r => r.partner_name === 'FOUNDEVER');
for (const w of pathWaves) {
  const eRows = eawWaves.filter(r => r.training_wave === w);
  if (eRows.length > 0) {
    console.log('EAW NH ' + w + ':', JSON.stringify(computeGroup(eRows)));
  }
  const fRows = fndWaves.filter(r => r.training_wave === w);
  if (fRows.length > 0) {
    console.log('Foundever NH ' + w + ':', JSON.stringify(computeGroup(fRows)));
  }
}

console.log('\n=== SECTION 3e: PARTNER BREAKDOWN ===');
const partners_nonP = ['INTUIT'];
for (const p of partners_nonP) {
  const pRows = nonP.filter(r => r.partner_name === p);
  if (pRows.length > 0) {
    console.log(p + ' (NonPathEDU):', JSON.stringify(computeGroup(pRows)));
  }
}
const partners_pathE = ['EDUCATION AT WORK', 'FOUNDEVER'];
for (const p of partners_pathE) {
  const pRows = pathE.filter(r => r.partner_name === p);
  if (pRows.length > 0) {
    console.log(p + ' (PathEDU):', JSON.stringify(computeGroup(pRows)));
  }
}

console.log('\n=== SECTION 3f: AGENT STATUS ===');
const statuses = ['Active', 'TermAfterPeak', 'TermBeforePeak'];
for (const s of statuses) {
  for (const ht of ['New Hire', 'Re-Hire']) {
    const nRows = nonP.filter(r => r.agent_status_adj === s && r.hire_type === ht);
    const pRows = pathE.filter(r => r.agent_status_adj === s && r.hire_type === ht);
    if (nRows.length > 0) console.log('NonPathEDU ' + ht + ' ' + s + ':', JSON.stringify(computeGroup(nRows)));
    if (pRows.length > 0) console.log('PathEDU ' + ht + ' ' + s + ':', JSON.stringify(computeGroup(pRows)));
  }
}

// TS by University
console.log('\n=== SECTION 5b: TS BY UNIVERSITY ===');
const uniData = parseTSV('data_ts_uni.tsv');
const universities = [...new Set(uniData.map(r => r.university))].filter(u => u && u !== 'null' && u !== 'NaN').sort();
for (const u of universities) {
  const uRows = uniData.filter(r => r.university === u);
  console.log(u + ':', JSON.stringify(computeGroup(uRows)));
}

// TS by Graduation Year
console.log('\n=== SECTION 5d: TS BY GRADUATION YEAR ===');
const gradData = parseTSV('data_ts_grad.tsv');
const gradYears = [...new Set(gradData.map(r => r.grad_year))].filter(g => g && g !== 'null' && g !== 'NaN').sort();
for (const g of gradYears) {
  const gRows = gradData.filter(r => r.grad_year === g);
  console.log(g + ':', JSON.stringify(computeGroup(gRows)));
}

// Section 5e: TermBeforePeak
console.log('\n=== SECTION 5e: TERM BEFORE PEAK ===');
const tbp_nonP = nonP.filter(r => r.agent_status_adj === 'TermBeforePeak');
const tbp_pathE = pathE.filter(r => r.agent_status_adj === 'TermBeforePeak');
console.log('NonPathEDU TermBeforePeak:', JSON.stringify(computeGroup(tbp_nonP)));
console.log('PathEDU TermBeforePeak:', JSON.stringify(computeGroup(tbp_pathE)));
const tbp_nonP_NH = nonP_NH.filter(r => r.agent_status_adj === 'TermBeforePeak');
const tbp_pathE_NH = pathE_NH.filter(r => r.agent_status_adj === 'TermBeforePeak');
console.log('NonPathEDU NH TermBeforePeak:', JSON.stringify(computeGroup(tbp_nonP_NH)));
console.log('PathEDU NH TermBeforePeak:', JSON.stringify(computeGroup(tbp_pathE_NH)));
