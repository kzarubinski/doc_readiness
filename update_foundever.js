'use strict';
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'PathEDU_Analysis_upd.html');
const TS_FV = path.join(__dirname, 'data_ts_foundever.tsv');
const PS_FV = path.join(__dirname, 'data_ps_foundever.tsv');

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

/* ────── TS per-expert: individual rows, expert_cnt=1 ────── */
function tsIndividualMetrics(rows) {
  return rows.map(r => {
    const cst = num(r.fs_eng) > 0 ? num(r.fs_cst_num) / num(r.fs_eng) : null;
    const tnps = num(r.fs_tnps_denom) > 0 ? (num(r.fs_tnps_num) / num(r.fs_tnps_denom)) * 100 : null;
    const conv = num(r.conv_denom) > 0 ? (num(r.conv_num) / num(r.conv_denom)) * 100 : null;
    return {
      name: r.expert_preferred_name || r.corp_login,
      major_ext: isMissing(r.major_ext) ? '(Unknown)' : r.major_ext,
      grad_year: isMissing(r.grad_year) ? '(Unknown)' : r.grad_year,
      cst, tnps, conv
    };
  });
}

/* ────── PS per-expert ────── */
function psIndividualMetrics(rows) {
  return rows.map(r => {
    const aht = num(r.ps_handle_cnt) > 0 ? num(r.ps_handle_min) / num(r.ps_handle_cnt) : null;
    const tnps = num(r.ps_tnps_denom) > 0 ? (num(r.ps_tnps_num) / num(r.ps_tnps_denom)) * 100 : null;
    return {
      name: r.expert_preferred_name || r.corp_login,
      major_ext: isMissing(r.major_ext) ? '(Unknown)' : r.major_ext,
      grad_year: isMissing(r.grad_year) ? '(Unknown)' : r.grad_year,
      aht, tnps
    };
  });
}

/* ────── TS aggregation (weighted) ────── */
function emptyTsAcc() {
  return { n: 0, fs_cst_num: 0, fs_eng: 0,
    fs_tnps_num: 0, fs_tnps_denom: 0,
    conv_num: 0, conv_denom: 0 };
}

function addTsRow(acc, r) {
  acc.n += 1;
  const cn = num(r.fs_cst_num), fe = num(r.fs_eng);
  if (cn !== null && fe !== null) { acc.fs_cst_num += cn; acc.fs_eng += fe; }
  const fn = num(r.fs_tnps_num), fd = num(r.fs_tnps_denom);
  if (fn !== null && fd !== null) { acc.fs_tnps_num += fn; acc.fs_tnps_denom += fd; }
  const cvn = num(r.conv_num), cvd = num(r.conv_denom);
  if (cvn !== null && cvd !== null) { acc.conv_num += cvn; acc.conv_denom += cvd; }
}

function tsMetrics(a) {
  return {
    cst: a.fs_eng > 0 ? a.fs_cst_num / a.fs_eng : null,
    tnps: a.fs_tnps_denom > 0 ? (a.fs_tnps_num / a.fs_tnps_denom) * 100 : null,
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
    return { label, n: acc.n, cst: m.cst, tnps: m.tnps, conv: m.conv };
  }).sort((a, b) => b.n - a.n);
}

/* ────── PS aggregation (weighted) ────── */
function emptyPsAcc() {
  return { n: 0, ps_handle_min: 0, ps_handle_cnt: 0, ps_tnps_num: 0, ps_tnps_denom: 0 };
}

function addPsRow(acc, r) {
  acc.n += 1;
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
    return { label, n: acc.n, aht: m.aht, tnps: m.tnps };
  }).sort((a, b) => b.n - a.n);
}

/* ────── Key findings ────── */
function bestWorst(arr, key) {
  const ok = arr.filter(r => r[key] !== null && Number.isFinite(r[key]));
  if (ok.length < 2) return null;
  ok.sort((a, b) => a[key] - b[key]);
  return { lo: ok[0], hi: ok[ok.length - 1] };
}

function tsKeyFinding(rows, groupLabel) {
  const parts = [];
  const v = bestWorst(rows, 'tnps');
  if (v) parts.push(`${v.hi.label} leads tNPS (${fmt(v.hi.tnps)}); ${v.lo.label} trails (${fmt(v.lo.tnps)}).`);
  const c = bestWorst(rows, 'cst');
  if (c) parts.push(`CST ranges ${fmt(c.lo.cst)}–${fmt(c.hi.cst)}.`);
  return parts.join(' ') || 'All groups perform similarly.';
}

function psKeyFinding(rows) {
  const parts = [];
  const v = bestWorst(rows, 'tnps');
  if (v) parts.push(`${v.hi.label} leads tNPS (${fmt(v.hi.tnps)}); ${v.lo.label} trails (${fmt(v.lo.tnps)}).`);
  const a = bestWorst(rows, 'aht');
  if (a) parts.push(`AHT ranges ${fmt(a.lo.aht)}–${fmt(a.hi.aht)} min.`);
  return parts.join(' ') || 'All groups perform similarly.';
}

/* ══════════════════════════════════════════════════
   LOAD DATA
   ══════════════════════════════════════════════════ */

console.log('Loading Foundever data...');
const tsRows = readTsv(TS_FV);
const psRows = readTsv(PS_FV);
console.log(`  TS rows: ${tsRows.length}, PS rows: ${psRows.length}`);

const tsGrad = aggregateTs(tsRows, 'grad_year');
const tsMajor = aggregateTs(tsRows, 'major_ext');
const psGrad = aggregatePs(psRows, 'grad_year');
const psMajor = aggregatePs(psRows, 'major_ext');

console.log('\n--- TS by Grad Year ---');
tsGrad.forEach(r => console.log(`  ${r.label}: n=${r.n}, CST=${fmt(r.cst)}, tNPS=${fmt(r.tnps)}, Conv=${fmt(r.conv)}`));
console.log('  Key: ' + tsKeyFinding(tsGrad));

console.log('\n--- TS by Major (ext) ---');
tsMajor.forEach(r => console.log(`  ${r.label}: n=${r.n}, CST=${fmt(r.cst)}, tNPS=${fmt(r.tnps)}, Conv=${fmt(r.conv)}`));
console.log('  Key: ' + tsKeyFinding(tsMajor));

console.log('\n--- PS by Grad Year ---');
psGrad.forEach(r => console.log(`  ${r.label}: n=${r.n}, AHT=${fmt(r.aht)}, tNPS=${fmt(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(psGrad));

console.log('\n--- PS by Major (ext) ---');
psMajor.forEach(r => console.log(`  ${r.label}: n=${r.n}, AHT=${fmt(r.aht)}, tNPS=${fmt(r.tnps)}`));
console.log('  Key: ' + psKeyFinding(psMajor));

/* ══════════════════════════════════════════════════
   BUILD HTML
   ══════════════════════════════════════════════════ */

function tsAggRows(arr) {
  return arr.map(r =>
    `              <tr><td>${r.label}</td><td>${r.n}</td><td>${fmt(r.cst)}</td><td>${fmt(r.tnps)}</td><td>${r.conv !== null ? fmt(r.conv) + '%' : 'N/A'}</td></tr>`
  ).join('\n');
}

function psAggRows(arr) {
  return arr.map(r =>
    `              <tr><td>${r.label}</td><td>${r.n}</td><td>${fmt(r.aht)}</td><td>${fmt(r.tnps)}</td></tr>`
  ).join('\n');
}

const sectionHtml = `<h2 id="s5fv">Section 5: Foundever (Marshall University) Detail</h2>

    <div class="callout">
        <strong>Note:</strong> This section isolates the Foundever / Marshall University cohort (${tsRows.length} TS, ${psRows.length} PS experts) and breaks performance down by <em>specific major</em> (major_ext) and <em>graduation year</em>. Because every Foundever PathEDU expert attends Marshall and works virtually, university and location are constant — the variation here comes from academic background and class standing.
    </div>

    <h3 id="s5a">5a. Tax Specialist — by Graduation Year</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Grad Year</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th></tr>
        </thead>
        <tbody>
${tsAggRows(tsGrad)}
        </tbody>
      </table>
    </div>
    <div class="callout warn">
        <strong>Key:</strong> ${tsKeyFinding(tsGrad)}
    </div>
    <div class="chart-row">
      <canvas id="c5aTsCST"></canvas>
      <canvas id="c5aTstNPS"></canvas>
    </div>

    <h3 id="s5b">5b. Tax Specialist — by Major (Specific)</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Major</th><th>Experts</th><th>CST</th><th>FS tNPS</th><th>Conv</th></tr>
        </thead>
        <tbody>
${tsAggRows(tsMajor)}
        </tbody>
      </table>
    </div>
    <div class="callout">
        <strong>Key:</strong> ${tsKeyFinding(tsMajor)}
    </div>
    <div class="chart-row">
      <canvas id="c5bTsCST"></canvas>
      <canvas id="c5bTstNPS"></canvas>
    </div>

    <h3 id="s5c">5c. Product Support — by Graduation Year</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Grad Year</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psAggRows(psGrad)}
        </tbody>
      </table>
    </div>
    <div class="callout warn">
        <strong>Key:</strong> ${psKeyFinding(psGrad)}
    </div>
    <div class="chart-row">
      <canvas id="c5cPsAHT"></canvas>
      <canvas id="c5cPstNPS"></canvas>
    </div>

    <h3 id="s5d">5d. Product Support — by Major (Specific)</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Major</th><th>Experts</th><th>AHT</th><th>tNPS</th></tr>
        </thead>
        <tbody>
${psAggRows(psMajor)}
        </tbody>
      </table>
    </div>
    <div class="callout">
        <strong>Key:</strong> ${psKeyFinding(psMajor)}
    </div>
    <div class="chart-row">
      <canvas id="c5dPsAHT"></canvas>
      <canvas id="c5dPstNPS"></canvas>
    </div>

    <hr class="section-divider">
`;

/* ══════════════════════════════════════════════════
   BUILD CHART JS
   ══════════════════════════════════════════════════ */

function chartBlock(canvasId, type, labels, datasets) {
  const labelsStr = JSON.stringify(labels);
  let dsStr = datasets.map(ds =>
    `{label:'${ds.label}',data:${JSON.stringify(ds.data)},backgroundColor:'${ds.bg}',borderColor:'${ds.border || ds.bg}',borderWidth:1}`
  ).join(',');
  const scaleOpts = type === 'bar'
    ? `scales:{y:{beginAtZero:${canvasId.includes('tNPS') ? 'false' : 'true'}}}`
    : '';
  return `new Chart(document.getElementById('${canvasId}'),{type:'${type}',data:{labels:${labelsStr},datasets:[${dsStr}]},options:{responsive:true,plugins:{legend:{display:true}},${scaleOpts}}});`;
}

const tsGradFiltered = tsGrad.filter(r => r.n >= 2);
const tsMajorFiltered = tsMajor.filter(r => r.n >= 2);
const psGradFiltered = psGrad.filter(r => r.n >= 2);
const psMajorFiltered = psMajor.filter(r => r.n >= 2);

const chartsJs = [
  chartBlock('c5aTsCST', 'bar',
    tsGradFiltered.map(r => r.label),
    [{ label: 'CST', data: tsGradFiltered.map(r => r.cst !== null ? +fmt(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]),
  chartBlock('c5aTstNPS', 'bar',
    tsGradFiltered.map(r => r.label),
    [{ label: 'FS tNPS', data: tsGradFiltered.map(r => r.tnps !== null ? +fmt(r.tnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]),
  chartBlock('c5bTsCST', 'bar',
    tsMajorFiltered.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
    [{ label: 'CST', data: tsMajorFiltered.map(r => r.cst !== null ? +fmt(r.cst) : 0), bg: 'rgba(54,162,235,0.6)', border: 'rgba(54,162,235,1)' }]),
  chartBlock('c5bTstNPS', 'bar',
    tsMajorFiltered.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
    [{ label: 'FS tNPS', data: tsMajorFiltered.map(r => r.tnps !== null ? +fmt(r.tnps) : 0), bg: 'rgba(255,159,64,0.6)', border: 'rgba(255,159,64,1)' }]),
  chartBlock('c5cPsAHT', 'bar',
    psGradFiltered.map(r => r.label),
    [{ label: 'AHT', data: psGradFiltered.map(r => r.aht !== null ? +fmt(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]),
  chartBlock('c5cPstNPS', 'bar',
    psGradFiltered.map(r => r.label),
    [{ label: 'tNPS', data: psGradFiltered.map(r => r.tnps !== null ? +fmt(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]),
  chartBlock('c5dPsAHT', 'bar',
    psMajorFiltered.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
    [{ label: 'AHT', data: psMajorFiltered.map(r => r.aht !== null ? +fmt(r.aht) : 0), bg: 'rgba(75,192,192,0.6)', border: 'rgba(75,192,192,1)' }]),
  chartBlock('c5dPstNPS', 'bar',
    psMajorFiltered.map(r => r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label),
    [{ label: 'tNPS', data: psMajorFiltered.map(r => r.tnps !== null ? +fmt(r.tnps) : 0), bg: 'rgba(255,99,132,0.6)', border: 'rgba(255,99,132,1)' }]),
].join('\n    ');

/* ══════════════════════════════════════════════════
   PATCH HTML
   ══════════════════════════════════════════════════ */

console.log('\nPatching HTML...');
let html = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

// 1. Insert the new section before the old Section 5 (Conclusions)
const oldS5 = '<h2 id="s5">';
const insertIdx = html.indexOf(oldS5);
if (insertIdx === -1) throw new Error('Could not find <h2 id="s5">');

html = html.slice(0, insertIdx) + sectionHtml + '\n    ' + html.slice(insertIdx);
console.log('  ✓ Foundever section inserted before Conclusions');

// 2. Renumber old Section 5 to Section 6
html = html.replace('<h2 id="s5">Conclusions &amp; Key Takeaways</h2>',
                     '<h2 id="s6">Conclusions &amp; Key Takeaways</h2>');
console.log('  ✓ Conclusions renumbered to Section 6');

// 3. Update TOC: add Foundever section and renumber Conclusions
const tocConclusionsOld = '<li><a href="#s5">Conclusions &amp; Key Takeaways</a></li>';
const tocNew = `<li><a href="#s5fv">Section 5: Foundever (Marshall) Detail</a>
                <ol style="list-style-type: lower-alpha; padding-left: 1rem;">
                    <li><a href="#s5a">5a. TS — Graduation Year</a></li>
                    <li><a href="#s5b">5b. TS — Major (Specific)</a></li>
                    <li><a href="#s5c">5c. PS — Graduation Year</a></li>
                    <li><a href="#s5d">5d. PS — Major (Specific)</a></li>
                </ol>
            </li>
            <li><a href="#s6">Conclusions &amp; Key Takeaways</a></li>`;
html = html.replace(tocConclusionsOld, tocNew);
console.log('  ✓ TOC updated');

// 4. Insert chart JS before closing </script>
const scriptClose = '</script>\n  </body>';
const chartInsert = '\n    // Section 5: Foundever charts\n    ' + chartsJs + '\n    ';
html = html.replace(scriptClose, chartInsert + scriptClose);
console.log('  ✓ Chart JS inserted');

// 5. Verify div balance
const divOpen = (html.match(/<div/g) || []).length;
const divClose = (html.match(/<\/div>/g) || []).length;
if (divOpen !== divClose) {
  console.error(`WARNING: div mismatch — open ${divOpen}, close ${divClose}`);
} else {
  console.log(`  ✓ div balance OK (${divOpen})`);
}

fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log(`\n✅ Done — wrote ${HTML_PATH} (${(html.length / 1024).toFixed(0)} KB)`);
