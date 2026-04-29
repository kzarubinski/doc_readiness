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

function computeGroupPS(rows) {
  const experts = sumField(rows, 'expert_cnt');
  const aht = weightedAvg('ps_handle_min', 'ps_handle_cnt', rows);
  const tnps = weightedAvg('ps_tnps_num', 'ps_tnps_denom', rows);
  return {
    experts,
    ps_handle_cnt: aht.denom,
    ps_aht: aht.denom > 0 ? aht.num / aht.denom : null,
    ps_handle_min: aht.num,
    ps_tnps: tnps.denom > 0 ? (tnps.num / tnps.denom * 100) : null,
    ps_tnps_num: tnps.num, ps_tnps_denom: tnps.denom,
  };
}

function fmt(v, dec=2) { return v !== null && v !== undefined ? v.toFixed(dec) : 'N/A'; }

const data = parseTSV('data_ps_overall.tsv');

const nonP = data.filter(r => r.expert_type === 'NonPathEDU');
const pathE = data.filter(r => r.expert_type === 'PathEDU');
const nonP_NH = nonP.filter(r => r.hire_type === 'New Hire');
const nonP_RH = nonP.filter(r => r.hire_type === 'Re-Hire');
const pathE_NH = pathE.filter(r => r.hire_type === 'New Hire');
const pathE_RH = pathE.filter(r => r.hire_type === 'Re-Hire');

console.log('=== SECTION 4a: OVERALL PS ===');
const overall_nonP = computeGroupPS(nonP);
const overall_pathE = computeGroupPS(pathE);
console.log('NonPathEDU:', JSON.stringify(overall_nonP));
console.log('PathEDU:', JSON.stringify(overall_pathE));

console.log('\n=== SECTION 4b: NH vs RH PS ===');
console.log('NonPathEDU NH:', JSON.stringify(computeGroupPS(nonP_NH)));
console.log('NonPathEDU RH:', JSON.stringify(computeGroupPS(nonP_RH)));
console.log('PathEDU NH:', JSON.stringify(computeGroupPS(pathE_NH)));
console.log('PathEDU RH:', JSON.stringify(computeGroupPS(pathE_RH)));

console.log('\n=== SECTION 4c: TRAINING WAVE (NH) ===');
const allWaves = [...new Set(data.filter(r => r.hire_type === 'New Hire').map(r => r.training_wave))].sort();
for (const w of allWaves) {
  const nRows = nonP_NH.filter(r => r.training_wave === w);
  const pRows = pathE_NH.filter(r => r.training_wave === w);
  if (nRows.length > 0) console.log('NonPathEDU NH ' + w + ':', JSON.stringify(computeGroupPS(nRows)));
  if (pRows.length > 0) console.log('PathEDU NH ' + w + ':', JSON.stringify(computeGroupPS(pRows)));
}

console.log('\n=== SECTION 4d: PARTNER BREAKDOWN ===');
const allPartners = [...new Set(data.map(r => r.partner_name))].sort();
for (const p of allPartners) {
  const pRows = data.filter(r => r.partner_name === p);
  const expert_type = pRows[0].expert_type;
  console.log(p + ' (' + expert_type + '):', JSON.stringify(computeGroupPS(pRows)));
}
// By hire type for partner breakdown
for (const p of allPartners) {
  for (const ht of ['New Hire', 'Re-Hire']) {
    const pRows = data.filter(r => r.partner_name === p && r.hire_type === ht);
    if (pRows.length > 0) {
      const expert_type = pRows[0].expert_type;
      console.log(p + ' ' + ht + ' (' + expert_type + '):', JSON.stringify(computeGroupPS(pRows)));
    }
  }
}

console.log('\n=== SECTION 4e: AGENT STATUS PS ===');
const statuses = ['Active', 'TermAfterPeak', 'TermBeforePeak'];
for (const s of statuses) {
  for (const ht of ['New Hire', 'Re-Hire']) {
    const nRows = nonP.filter(r => r.agent_status_adj === s && r.hire_type === ht);
    const pRows = pathE.filter(r => r.agent_status_adj === s && r.hire_type === ht);
    if (nRows.length > 0) console.log('NonPathEDU ' + ht + ' ' + s + ':', JSON.stringify(computeGroupPS(nRows)));
    if (pRows.length > 0) console.log('PathEDU ' + ht + ' ' + s + ':', JSON.stringify(computeGroupPS(pRows)));
  }
}

// PS by University
console.log('\n=== SECTION 5a: PS BY UNIVERSITY ===');
const uniData = parseTSV('data_ps_uni.tsv');
const universities = [...new Set(uniData.map(r => r.university))].filter(u => u && u !== 'null' && u !== 'NaN' && u !== '?').sort();
for (const u of universities) {
  const uRows = uniData.filter(r => r.university === u);
  console.log(u + ':', JSON.stringify(computeGroupPS(uRows)));
}

// PS by Graduation Year
console.log('\n=== SECTION 5c: PS BY GRADUATION YEAR ===');
const gradData = parseTSV('data_ps_grad.tsv');
const gradYears = [...new Set(gradData.map(r => r.grad_year))].filter(g => g && g !== 'null' && g !== 'NaN').sort();
for (const g of gradYears) {
  const gRows = gradData.filter(r => r.grad_year === g);
  console.log(g + ':', JSON.stringify(computeGroupPS(gRows)));
}

// Section 5e: TermBeforePeak PS
console.log('\n=== SECTION 5e: TERM BEFORE PEAK PS ===');
const tbp_nonP = nonP.filter(r => r.agent_status_adj === 'TermBeforePeak');
const tbp_pathE = pathE.filter(r => r.agent_status_adj === 'TermBeforePeak');
console.log('NonPathEDU TermBeforePeak:', JSON.stringify(computeGroupPS(tbp_nonP)));
console.log('PathEDU TermBeforePeak:', JSON.stringify(computeGroupPS(tbp_pathE)));
