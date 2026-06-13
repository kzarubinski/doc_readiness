'use strict';

const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'TS_Expert_Analysis.html');
const JSON_PATH = path.join(__dirname, 'ts_full_report.json');

const r = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
let html = fs.readFileSync(HTML, 'utf8');

const fsTs = r.overall.fs.ts;
const fsNts = r.overall.fs.nts;
const ttlaTs = r.overall.ttla.ts;
const ttlaNts = r.overall.ttla.nts;
const m = r.mixAppendix.fs;
const tm = r.mixAppendix.ttla;
const pl1Cst = r.pl1.mix.fs.cst;
const ta = r.triageAllPL;

function gap(a, b) { return Math.round((a - b) * 100) / 100; }

function fmtGap(a, b) {
  const g = gap(a, b);
  return g > 0 ? `+${g}` : String(g);
}

function replaceMixTbody(afterHeaderSnippet, newRows) {
  const idx = html.indexOf(afterHeaderSnippet);
  if (idx === -1) {
    console.warn('WARN: header not found:', afterHeaderSnippet.slice(0, 80));
    return;
  }
  const tbodyStart = html.indexOf('<tbody>', idx);
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) return;
  html = html.slice(0, tbodyStart + 7) + '\n' + newRows + '\n' + html.slice(tbodyEnd);
}

// Remove Section 6 TOC link
html = html.replace(/<li><a href="#conclusions">Conclusions &amp; Key Takeaways<\/a><\/li>\s*\n/, '');

// Forecast group table (section 3c)
if (r.html.forecastGroup) {
  replaceMixTbody('<strong>FS tNPS &amp; IR by Forecast Group Category — TS vs Non-TS</strong>', r.html.forecastGroup);
  html = html.replace(
    /Volume based on tnps_denominator \(number of surveys\)\. % of Volume is calculated separately for TS \(total [^)]+\) and Non-TS \(total [^)]+\)\./,
    `Volume based on tnps_denominator (number of surveys). % of Volume is calculated separately for TS (total ${r.totals.tsSurveys.toLocaleString('en-US')}) and Non-TS (total ${r.totals.ntsSurveys.toLocaleString('en-US')}).`
  );
}

// Fix PL1 HC callout narrative
html = html.replace(
  /SKU &times; customer-type mix on HC explains <strong>6\.08 pts<\/strong> of additional gap beyond the raw &minus;18\.28 deficit;/,
  'After SKU &times; customer-type adjustment, the HC gap widens from &minus;18.28 to &minus;24.36 (mix effect &minus;6.08);'
);

// Mix tables — section 5, appendix, summary
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires</strong>', r.html.pl1FsMix);
replaceMixTbody('<strong>TTLA Mix-Adjusted Summary — PL1 New Hires</strong>', r.html.pl1TtlaMix);
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires, TRIAGE + AMEND</strong>', r.html.pl1TriageMix);
replaceMixTbody('<strong>FS Mix-Adjusted Summary — PL1 New Hires, NON TRIAGE</strong>', r.html.pl1NonTriageMix);
replaceMixTbody('<h3 id="a1-fs-mix">A1. FS — Mix-Adjusted Performance</h3>', r.html.fsMixAppendix);
replaceMixTbody('<h2 id="summary-fs">Full Service Overview</h2>', r.html.fsMixAppendix);
replaceMixTbody('<h3 id="a2-ttla-mix">A2. TTLA — Mix-Adjusted Performance</h3>', r.html.ttlaMixAppendix);
replaceMixTbody('<h3>TTLA &mdash; Mix-Adjusted Performance</h3>', r.html.ttlaMixAppendix);

// FS mix-adjusted narratives (CST corrected — Premium SKU now included)
html = html.replace(
  /<strong>FS Key Finding:<\/strong> Mix-adjustment reveals that TS's CST advantage \(2\.57 vs 2\.96\) is partly driven by SKU mix — mix-adjusted CST is [^<]+\. The tNPS gap widens after adjustment \([^)]+\), and HC gap widens substantially \([^)]+\) once SKU &times; customer mix is applied\. SQS shows a small mix effect \([^)]+\)\./,
  `<strong>FS Key Finding:</strong> Mix-adjustment reveals that TS's raw CST advantage (${m.cst.actual} vs ${m.cst.nts}) is <strong>entirely driven by SKU mix</strong>. After reweighting to Non-TS's SKU distribution, mix-adjusted CST rises to ${m.cst.adj} — slightly <em>worse</em> than Non-TS (adj gap ${m.cst.adjGap > 0 ? '+' : ''}${m.cst.adjGap}). TS is slower (higher CST) on Basic and Deluxe per-SKU; handling far fewer Premium returns creates the illusion of overall CST advantage. The tNPS gap widens after adjustment (${m.tnps.rawGap} &rarr; ${m.tnps.adjGap}), and HC gap widens substantially (${m.hc.rawGap} &rarr; ${m.hc.adjGap}) once SKU &times; customer mix is applied.`
);

html = html.replace(
  /a negative CST\/AHT mix effect means TS's mix was making them look better/,
  'a <strong>positive</strong> CST/AHT mix effect means TS\'s mix was making them look better (lower CST/AHT)'
);

html = html.replace(
  /CST mix-adjustment reduces TS's raw disadvantage \(\+0\.56 &rarr; \+0\.23\)\./,
  `CST mix-adjustment has minimal effect on the PL1 gap (+${pl1Cst.rawGap} &rarr; +${pl1Cst.adjGap}); SKU mix is not a major confounder at this level.`
);

// SKU mix insight callouts — TS is worse on Basic/Deluxe per-SKU CST
html = html.replace(
  /This SKU mix difference significantly contributes to Tax Specialists' lower overall CST despite having higher per-SKU CST for Basic and Deluxe\./g,
  `This SKU mix difference helps explain TS's favorable raw overall CST. TS has higher (worse) per-SKU CST on Basic and Deluxe; handling far fewer Premium returns masks that underlying disadvantage.`
);

// Mix chart data (FS compare + effect)
html = html.replace(
  /\{ label: 'Actual TS', data: \[64\.54, 60\.99, 85\.68, 45\.72, 100-2\.57\]/,
  `{ label: 'Actual TS', data: [${m.tnps.actual}, ${m.ir.actual}, ${m.sqs.actual}, ${m.hc.actual}, ${100 - m.cst.actual}]`
);
html = html.replace(
  /\{ label: 'Mix-Adjusted TS', data: \[61\.44, 61\.35, 85\.47, 36\.31, 100-2\.34\]/,
  `{ label: 'Mix-Adjusted TS', data: [${m.tnps.adj}, ${m.ir.adj}, ${m.sqs.adj}, ${m.hc.adj}, ${100 - m.cst.adj}]`
);
html = html.replace(
  /\{ label: 'Non-TS', data: \[72\.2, 72\.48, 87\.57, 66\.51, 100-2\.96\]/,
  `{ label: 'Non-TS', data: [${m.tnps.nts}, ${m.ir.nts}, ${m.sqs.nts}, ${m.hc.nts}, ${100 - m.cst.nts}]`
);
html = html.replace(
  /\{ label: 'Adjusted Gap', data: \[-10\.76, -0\.61, -2\.1, -11\.13, -30\.21\]/,
  `{ label: 'Adjusted Gap', data: [${m.tnps.adjGap}, ${m.cst.adjGap}, ${m.sqs.adjGap}, ${m.ir.adjGap}, ${m.hc.adjGap}]`
);
html = html.replace(
  /\{ label: 'Mix Effect', data: \[-3\.1, -0\.23, -0\.21, 0\.36, -9\.41\]/,
  `{ label: 'Mix Effect', data: [${m.tnps.mixEffect}, ${m.cst.mixEffect}, ${m.sqs.mixEffect}, ${m.ir.mixEffect}, ${m.hc.mixEffect}]`
);

// Analysis scope — CST mix-adjusted finding
html = html.replace(
  /<p>There's also a sizable underperformance in CST\/Complete; exact magnitude after removing confounders is being confirmed\.<\/p>/,
  `<p>After SKU &times; customer-type mix adjustment, FS CST is slightly <strong>worse</strong> for Tax Specialists than Non-TS (mix-adj ${m.cst.adj} vs ${m.cst.nts}; adj gap ${m.cst.adjGap > 0 ? '+' : ''}${m.cst.adjGap}). The raw CST advantage is entirely a composition effect — TS handles far fewer Premium returns.</p>`
);

// Summary triage tNPS table
const allTnps = m.tnps;
replaceMixTbody('<strong>FS tNPS Mix-Adjusted by SKU &mdash; Triage vs Non-Triage</strong>',
  `<tr><td><strong>TRIAGE + AMEND</strong></td><td>${ta.triage.actual}</td><td>${ta.triage.adj}</td><td>${ta.triage.nts}</td><td class="worse">${ta.triage.rawGap}</td><td class="worse">${ta.triage.adjGap}</td><td>${ta.triage.mixEffect > 0 ? '+' : ''}${ta.triage.mixEffect}</td></tr>\n` +
  `<tr><td><strong>NON TRIAGE</strong></td><td>${ta.nonTriage.actual}</td><td>${ta.nonTriage.adj}</td><td>${ta.nonTriage.nts}</td><td class="better">${ta.nonTriage.rawGap > 0 ? '+' : ''}${ta.nonTriage.rawGap}</td><td class="worse">${ta.nonTriage.adjGap}</td><td>${ta.nonTriage.mixEffect}</td></tr>\n` +
  `<tr><td><strong>ALL</strong></td><td>${allTnps.actual}</td><td>${allTnps.adj}</td><td>${allTnps.nts}</td><td class="worse">${allTnps.rawGap}</td><td class="worse">${allTnps.adjGap}</td><td>${allTnps.mixEffect}</td></tr>`);

// Fix PL1 HC callout duplicate text
html = html.replace(
  /the <strong>&minus;24\.36 pt adjusted deficit<\/strong> confirms Handle Conversion remains a genuine performance issue &mdash; Handle Conversion is still a genuine performance issue for PL1 New Hire Tax Specialists\./,
  'the <strong>&minus;24.36 pt adjusted deficit</strong> confirms Handle Conversion remains a genuine performance issue for PL1 New Hire Tax Specialists.'
);

// TTLA PL1 mix callout — add SQS mention
html = html.replace(
  /IR advantage also holds after customer-type adjustment \(\+4\.38 &rarr; \+4\.49\)\. TS outperformance on TTLA among PL1 New Hires is genuine/,
  `IR (+4.38 &rarr; +4.49) and SQS (+2.11 &rarr; +2.19) advantages also hold after mix adjustment. TS outperformance on TTLA among PL1 New Hires is genuine`
);

// Summary TTLA key finding paragraph
html = html.replace(
  /<p><strong>TTLA Key Finding:<\/strong> Mix-adjustment confirms and slightly strengthens TS's TTLA advantage\. The tNPS gap increases from \+2\.71 to \+3\.06 after adjustment, and the AHT gap narrows from \+1\.66 to \+1\.32 minutes\. The IR advantage is virtually unchanged\. TS's TTLA outperformance is genuine and not a composition artifact\.<\/p>/,
  `<p><strong>TTLA Key Finding:</strong> Mix-adjustment confirms and slightly strengthens TS's TTLA advantage. The tNPS gap increases from +${tm.tnps.rawGap} to +${tm.tnps.adjGap}; AHT gap is +${tm.aht.adjGap} min after adjustment. SQS advantage holds (+${tm.sqs.adjGap} adjusted). TS's TTLA outperformance is genuine and not a composition artifact.</p>`
);

// Summary non-triage narrative
html = html.replace(
  /<p><strong>tNPS \(Non-Triage\):<\/strong> TS appears on par raw \(\+1\.21\), but after SKU adjustment the gap reverses to &minus;3\.97 pts\./,
  `<p><strong>tNPS (Non-Triage):</strong> TS appears on par raw (+${ta.nonTriage.rawGap}), but after SKU adjustment the gap reverses to ${ta.nonTriage.adjGap} pts.`
);

// HC summary — ~20 points below
html = html.replace(
  /Handle Conversion remains a critical issue, with TS nearly <strong>20 points below<\/strong> Non-TS\./,
  `Handle Conversion remains a critical issue, with TS <strong>${Math.abs(m.hc.rawGap).toFixed(2)} points below</strong> Non-TS raw (${m.hc.adjGap} adjusted).`
);

// Chart JS — mix compare labels
html = html.replace(
  /labels: \['tNPS', 'IR', 'HC \(inv CST\)'\]/,
  "labels: ['tNPS', 'IR', 'SQS', 'HC', 'CST (inv)']"
);

// M2 manager tables
replaceMixTbody('<strong>FS Performance by M2 Manager — TS vs Non-TS</strong>', r.html.m2Fs);
replaceMixTbody('<strong>TTLA Performance by M2 Manager — TS vs Non-TS</strong>', r.html.m2Ttla);

// Footer data sources
html = html.replace(
  /<p>Data sources: TS_expert_data\.csv[\s\S]*?Expert_Analysis_data_DP3\.csv \(225,931 rows\)<\/p>/,
  `<p>Data sources: Expert_Analysis_data_DP.csv (${r.sources.dp.toLocaleString('en-US')} rows) &bull; Expert_Analysis_data_DP2.csv (${r.sources.dp2.toLocaleString('en-US')} rows) &bull; Expert_Analysis_data_DP3.csv (${r.sources.dp3.toLocaleString('en-US')} rows)</p>`
);

fs.writeFileSync(HTML, html);
console.log('Patched', HTML);
